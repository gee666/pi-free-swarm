// Fake `pi --mode rpc` for agent tests. Runs under Node's type stripping (no imports outside node:).
//
// Env:
//   FAKE_PI_SCENARIO  path to a JSON FakePiScenario; missing = every prompt gets one reply, then settles.
//   FAKE_PI_LOG       JSONL file; gets {"fake":"spawn",argv,pid}, every received command verbatim,
//                     {"fake":"signal",signal} and {"fake":"grandchild",pid} records.
//
// Real argument list is accepted; `--session <file>` gets real-format entries (header on the first
// message, then user/assistant/toolResult messages and compaction entries).
//
// A run: prompt response, agent_start, turn_start, the user message, the run's steps, then (if steers
// are still queued) one more turn that injects them and replies, turn_end, agent_end, agent_settled.
// Prompts arriving during a run are queued as steering (queue_update, then the response) and injected
// one user message each at the next "turn" step or the end of the run.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface FakeUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

export type FakeStep =
  | { type: "reply"; text?: string; thinking?: boolean; usage?: FakeUsage }
  /** A tool that stays silent for `ms`; steering prompts are queued meanwhile. */
  | { type: "tool"; name?: string; ms: number }
  /** Turn boundary: queued steers arrive here, each as its own user message_start. */
  | { type: "turn" }
  | { type: "compaction"; usage?: FakeUsage }
  | { type: "wait"; ms: number }
  /** Never continues: a startup or inactivity stall. */
  | { type: "silence" }
  | { type: "exit"; code?: number; stderr?: string }
  /** extension_ui_request; blocks until the matching extension_ui_response arrives. */
  | { type: "dialog"; method?: "select" | "confirm" | "input" | "editor" }
  /** Fire-and-forget UI record. */
  | { type: "notify" }
  /** A sleeping process in the fake's process group, to prove group kills. */
  | { type: "grandchild" };

export interface FakePiScenario {
  /** Before any command is answered. */
  startup?: FakeStep[];
  /** Steps of the n-th run; the last entry repeats. */
  runs?: FakeStep[][];
  /** Hold every agent_settled until the next command arrives, like pi's settle gap. */
  settleGap?: boolean;
  /** Prompts containing this text are answered success:false. */
  reject?: string;
  /** Log SIGTERM but keep running, so only SIGKILL stops the fake. */
  ignoreSigterm?: boolean;
  /** The n-th spawn with this scenario file uses spawns[n] (last repeats); counted in `<file>.spawns`. */
  spawns?: FakePiScenario[];
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const logFile = process.env.FAKE_PI_LOG;
const log = (record: Json) => {
  if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
};
const emit = (record: Json) => process.stdout.write(`${JSON.stringify(record)}\n`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const forever = () => new Promise<never>(() => undefined);

function loadScenario(): FakePiScenario {
  const file = process.env.FAKE_PI_SCENARIO;
  if (!file) return {};
  // Written by the test harness from a typed FakePiScenario.
  const scenario = JSON.parse(fs.readFileSync(file, "utf8")) as FakePiScenario;
  if (!scenario.spawns?.length) return scenario;
  const counter = `${file}.spawns`;
  const index = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(index + 1));
  return scenario.spawns[Math.min(index, scenario.spawns.length - 1)];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const scenario = loadScenario();
const sessionFile = argValue("--session");
log({ fake: "spawn", argv: process.argv.slice(2), pid: process.pid });

// ── Session file ─────────────────────────────────────────────────────────────
let lastEntryId: string | null = null;
if (sessionFile && fs.existsSync(sessionFile)) {
  const lastLine = fs.readFileSync(sessionFile, "utf8").trim().split("\n").pop();
  const last: unknown = lastLine ? JSON.parse(lastLine) : null;
  lastEntryId = isJson(last) && typeof last.id === "string" ? last.id : null;
}

function persist(entry: Json): void {
  if (!sessionFile) return;
  if (!fs.existsSync(sessionFile) || fs.statSync(sessionFile).size === 0) {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    const header = { type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString() };
    fs.writeFileSync(sessionFile, `${JSON.stringify({ ...header, cwd: process.cwd() })}\n`);
  }
  const id = randomUUID().slice(0, 8);
  const full = { ...entry, id, parentId: lastEntryId, timestamp: new Date().toISOString() };
  fs.appendFileSync(sessionFile, `${JSON.stringify(full)}\n`);
  lastEntryId = id;
}

function usageRecord(usage: FakeUsage = {}): Json {
  const input = usage.input ?? 10;
  const output = usage.output ?? 5;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const totalTokens = input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, totalTokens, cost: { total: usage.cost ?? 0.001 } };
}

// ── Messages ─────────────────────────────────────────────────────────────────
function userMessage(text: string): void {
  const message = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
  emit({ type: "message_start", message });
  emit({ type: "message_end", message });
  persist({ type: "message", message });
}

function assistantMessage(content: Json[], usage: FakeUsage | undefined, stopReason: string): void {
  const base = { role: "assistant", provider: "fake", model: "fake-model", timestamp: Date.now() };
  emit({ type: "message_start", message: { ...base, content: [], stopReason: "pending" } });
  for (const block of content) {
    const kind = block.type === "thinking" ? "thinking" : block.type === "text" ? "text" : "toolcall";
    emit({ type: "message_update", assistantMessageEvent: { type: `${kind}_start` } });
  }
  const message = { ...base, content, usage: usageRecord(usage), stopReason };
  emit({ type: "message_end", message });
  persist({ type: "message", message });
}

// ── Run state ────────────────────────────────────────────────────────────────
const steering: string[] = [];
let running = false;
let runCount = 0;
let heldSettle = false;
let dialogWaiter: { id: string; resolve(): void } | null = null;

function injectSteering(): void {
  while (steering.length > 0) {
    const text = steering.shift() ?? "";
    emit({ type: "queue_update", steering: [...steering], followUp: [] });
    userMessage(text);
  }
}

async function runStep(step: FakeStep): Promise<void> {
  switch (step.type) {
    case "reply": {
      const content: Json[] = step.thinking ? [{ type: "thinking", thinking: "Hmm." }] : [];
      content.push({ type: "text", text: step.text ?? "ok" });
      assistantMessage(content, step.usage, "stop");
      return;
    }
    case "tool": {
      const toolCallId = `call_${randomUUID().slice(0, 8)}`;
      const toolName = step.name ?? "bash";
      const args = { command: "sleep", timeout: 30 };
      assistantMessage([{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }], undefined, "toolUse");
      emit({ type: "tool_execution_start", toolCallId, toolName, args });
      await sleep(step.ms);
      const result = { content: [{ type: "text", text: "(no output)" }] };
      emit({ type: "tool_execution_end", toolCallId, toolName, result, isError: false });
      const message = { role: "toolResult", toolCallId, toolName, ...result, isError: false, timestamp: Date.now() };
      emit({ type: "message_start", message });
      emit({ type: "message_end", message });
      persist({ type: "message", message });
      return;
    }
    case "turn":
      emit({ type: "turn_end", toolResults: [] });
      emit({ type: "turn_start" });
      injectSteering();
      return;
    case "compaction": {
      const usage = usageRecord(step.usage);
      emit({ type: "compaction_start", reason: "threshold" });
      const result = { summary: "## Goal", firstKeptEntryId: lastEntryId, tokensBefore: 1000, usage };
      emit({ type: "compaction_end", reason: "threshold", result, aborted: false, willRetry: false });
      persist({ type: "compaction", ...result, fromHook: false });
      return;
    }
    case "wait":
      return sleep(step.ms);
    case "silence":
      return forever();
    case "exit":
      if (step.stderr) process.stderr.write(`${step.stderr}\n`);
      process.exit(step.code ?? 1);
    case "dialog": {
      const id = `dialog-${randomUUID().slice(0, 8)}`;
      const answered = new Promise<void>((resolve) => (dialogWaiter = { id, resolve }));
      emit({ type: "extension_ui_request", id, method: step.method ?? "confirm", title: "Continue?" });
      return answered;
    }
    case "notify":
      emit({ type: "extension_ui_request", id: randomUUID(), method: "notify", message: "hello", notifyType: "info" });
      return;
    case "grandchild": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      log({ fake: "grandchild", pid: child.pid });
      return;
    }
  }
}

async function run(text: string): Promise<void> {
  running = true;
  const runs = scenario.runs ?? [[{ type: "reply" }]];
  const steps = runs[Math.min(runCount++, runs.length - 1)];
  emit({ type: "agent_start" });
  emit({ type: "turn_start" });
  userMessage(text);
  for (const step of steps) await runStep(step);
  if (steering.length > 0) await runStep({ type: "turn" }).then(() => runStep({ type: "reply" }));
  emit({ type: "turn_end", toolResults: [] });
  emit({ type: "agent_end", messages: [], willRetry: false });
  running = false;
  if (scenario.settleGap) heldSettle = true;
  else emit({ type: "agent_settled" });
}

// ── Commands ─────────────────────────────────────────────────────────────────
function respond(command: Json, extra: Json = { success: true }): void {
  emit({ type: "response", id: command.id, command: command.type, ...extra });
}

function handlePrompt(command: Json): void {
  const text = typeof command.message === "string" ? command.message : "";
  if (running) {
    steering.push(text);
    emit({ type: "queue_update", steering: [...steering], followUp: [] });
    respond(command);
    return;
  }
  if (scenario.reject && text.includes(scenario.reject)) {
    respond(command, { success: false, error: "Rejected by fake pi." });
    return;
  }
  respond(command);
  void run(text);
}

function handleCommand(command: Json): void {
  if (heldSettle) {
    heldSettle = false;
    emit({ type: "agent_settled" });
  }
  if (command.type === "prompt") handlePrompt(command);
  else if (command.type === "set_steering_mode") respond(command);
  else respond(command, { success: false, error: `Unknown command: ${String(command.type)}` });
}

const queued: Json[] = [];
let started = false;

function onLine(line: string): void {
  if (!line.trim()) return;
  const command: unknown = JSON.parse(line);
  if (!isJson(command)) return;
  log(command);
  if (command.type === "extension_ui_response") {
    if (dialogWaiter && command.id === dialogWaiter.id) {
      const waiter = dialogWaiter;
      dialogWaiter = null;
      waiter.resolve();
    }
    return;
  }
  if (started) handleCommand(command);
  else queued.push(command);
}

process.on("SIGTERM", () => {
  log({ fake: "signal", signal: "SIGTERM" });
  if (!scenario.ignoreSigterm) process.exit(143);
});

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) onLine(line);
});
process.stdin.on("end", () => process.exit(0));

for (const step of scenario.startup ?? []) await runStep(step);
started = true;
for (const command of queued.splice(0)) handleCommand(command);

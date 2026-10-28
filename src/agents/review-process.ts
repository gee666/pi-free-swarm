import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { systemClock, type Clock } from "../clock.js";
import {
  MAX_CAPTURED_STDERR_CHARS,
  RESERVED_ENV_PREFIX,
  REVIEW_FINDINGS_FILE,
  REVIEW_OUTPUT_MAX,
  REVIEW_SYSTEM_PROMPT,
  REVIEW_TIMEOUT_MS,
} from "../constants.js";
import type { ModelSelection, UsageSample } from "../runtime-types.js";
import { buildChildProcessEnv, getPiCommand, stopProcessTree } from "./launch.js";
import { registerAgentProcess } from "./process-registry.js";
import { createJsonlSplitter, extractUsage, parseRpcLine, type RpcRecord } from "./rpc-events.js";

export interface ReviewProcessOptions {
  cwd: string;
  sessionFile: string;
  revision: number;
  resume?: boolean;
  prompt: string;
  model: ModelSelection;
  signal?: AbortSignal;
  clock?: Clock;
  onSpawn(pid: number): void;
  onUsage(sample: UsageSample): void;
}
export interface ReviewProcessResult {
  verdict: "accept" | "changes" | null;
  findings: string;
}
export function parseReviewVerdict(text: string): ReviewProcessResult["verdict"] {
  let verdict: ReviewProcessResult["verdict"] = null;
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence) && line.trim() === marker) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const plain = line
      .trim()
      .replace(/^(?:(?:[-+*]|\d+[.)]|#+)\s+)+/, "")
      .replace(/[*_]/g, "");
    const match = /^VERDICT:\s*(accept|changes)(?:\s+—\s+.*)?$/i.exec(plain)?.[1]?.toLowerCase();
    if (match === "accept" || match === "changes") verdict = match;
  }
  return verdict;
}
function assistantText(event: RpcRecord): string | null {
  if (event.type !== "message_end") return null;
  const message = event.message;
  if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "assistant")
    return null;
  if ("stopReason" in message && message.stopReason !== "stop") return "";
  if (!("content" in message) || !Array.isArray(message.content)) return "";
  return message.content
    .flatMap((block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}
export function runReviewProcess(options: ReviewProcessOptions): Promise<ReviewProcessResult> {
  const clock = options.clock ?? systemClock;
  const { command, argsPrefix } = getPiCommand();
  const env = buildChildProcessEnv({});
  for (const key of Object.keys(env)) if (key.startsWith(RESERVED_ENV_PREFIX)) delete env[key];
  const args = [
    ...argsPrefix,
    "--mode",
    "json",
    "--print",
    "--no-extensions",
    "--no-mcp",
    "--tools",
    "read,bash,grep,find,ls",
    "--session",
    options.sessionFile,
    "--append-system-prompt",
    REVIEW_SYSTEM_PROMPT,
    "--model",
    `${options.model.provider}/${options.model.modelId}`,
  ];
  if (options.model.thinkingLevel) args.push("--thinking", options.model.thinkingLevel);
  mkdirSync(path.dirname(options.sessionFile), { recursive: true });
  if (!options.resume) rmSync(options.sessionFile, { force: true });
  const findingsFile = path.join(path.dirname(options.sessionFile), `${options.revision}-${REVIEW_FINDINGS_FILE}`);
  const proc = spawn(command, args, { cwd: options.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  registerAgentProcess(proc);
  return new Promise((resolve) => {
    let finalText = "";
    let stderr = "";
    let failure: string | undefined;
    const fail = (reason: string) => {
      failure ??= reason;
      stopProcessTree(proc, true);
    };
    const timer = clock.after(REVIEW_TIMEOUT_MS, () =>
      fail("Review timed out after 30 minutes. Call swarm_review again."),
    );
    const abort = () => fail("Review cancelled. Call swarm_review again.");
    options.signal?.addEventListener("abort", abort, { once: true });
    const splitter = createJsonlSplitter((line) => {
      const event = parseRpcLine(line);
      if (!event) return;
      const usage = extractUsage(event);
      if (usage) options.onUsage(usage);
      const text = assistantText(event);
      if (text !== null) finalText = text;
    });
    const consume = (action: () => void) => {
      try {
        action();
      } catch (error) {
        fail(`Review failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    proc.stdout.on("data", (chunk: Buffer) => consume(() => splitter.push(chunk)));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_CAPTURED_STDERR_CHARS);
    });
    proc.on("error", (error) => {
      failure = `Review failed to start: ${error.message}`;
    });
    proc.stdin.on("error", (error) => fail(`Review input failed: ${error.message}`));
    proc.once("close", (code, signal) => {
      timer.cancel();
      options.signal?.removeEventListener("abort", abort);
      consume(() => splitter.end());
      if (code !== 0) failure ??= `Reviewer exited (${signal ?? code}). ${stderr.trim()}`;
      const verdict = failure ? null : parseReviewVerdict(finalText);
      const findings = failure ?? (verdict ? finalText : `Unparsable review verdict.\n${finalText}`);
      try {
        writeFileSync(findingsFile, findings, "utf8");
        resolve({
          verdict,
          findings:
            findings.length <= REVIEW_OUTPUT_MAX
              ? findings
              : `${findings.slice(0, REVIEW_OUTPUT_MAX)}\nFull review: ${findingsFile}`,
        });
      } catch (error) {
        resolve({
          verdict: null,
          findings: `Could not save review findings: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
    consume(() => {
      if (proc.pid !== undefined) options.onSpawn(proc.pid);
      if (options.signal?.aborted) abort();
      proc.stdin.end(options.prompt);
    });
  });
}

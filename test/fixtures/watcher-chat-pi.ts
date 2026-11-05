import { appendFileSync, existsSync, watch } from "node:fs";
import path from "node:path";

type RecordValue = Record<string, unknown>;
const mode = process.env.FAKE_CHAT_MODE ?? "error";
const gate = process.env.FAKE_CHAT_CLOSE_GATE;
const logFile = process.env.FAKE_PI_LOG;
const session = process.argv[process.argv.indexOf("--session") + 1];
const emit = (record: RecordValue) => process.stdout.write(JSON.stringify(record) + "\n");
const log = (record: RecordValue) => {
  if (logFile) appendFileSync(logFile, JSON.stringify(record) + "\n");
};
const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } };
const assistant = (stopReason: string, content: unknown[], errorMessage?: string) =>
  emit({
    type: "message_end",
    message: { role: "assistant", model: "watcher-model", stopReason, content, errorMessage, usage },
  });
log({ fake: "spawn", pid: process.pid, session });
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    const command: RecordValue = JSON.parse(line);
    log(command);
    const accepted = !(command.type === "prompt" && mode === "reject");
    emit({
      type: "response",
      id: command.id,
      command: command.type,
      success: accepted,
      error: accepted ? undefined : "prompt rejected",
    });
    if (command.type !== "prompt" || !accepted) continue;
    emit({ type: "agent_start" });
    emit({ type: "turn_start" });
    if (mode === "hang" || mode === "reject") continue;
    if (mode === "toolThenText") {
      assistant("toolUse", [
        { type: "text", text: "Intermediate" },
        { type: "toolCall", id: "call", name: "swarm_overview", arguments: {} },
      ]);
      assistant("stop", [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Final answer" },
      ]);
    } else {
      assistant(mode === "empty" ? "stop" : mode, [], "Provider unavailable");
    }
    emit({ type: "agent_settled", aborted: mode === "aborted" });
  }
});
process.on("SIGTERM", () => {
  log({ fake: "signal", pid: process.pid });
  assistant("stop", [{ type: "text", text: "Late old response" }]);
  emit({ type: "agent_settled" });
  const finish = () => {
    log({ fake: "exit", pid: process.pid });
    process.exit(0);
  };
  if (!gate || existsSync(gate)) return finish();
  const watcher = watch(path.dirname(gate), () => {
    if (!existsSync(gate)) return;
    watcher.close();
    finish();
  });
});
process.stdin.on("end", () => process.exit(0));

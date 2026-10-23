// Minimal real JSONL child for usage emitted during joined shutdown. No model or tool executes.
const modelIndex = process.argv.indexOf("--model");
const selected = modelIndex < 0 ? "fake/fake-model" : (process.argv[modelIndex + 1] ?? "fake/fake-model");
const separator = selected.indexOf("/");
const provider = separator < 0 ? "fake" : selected.slice(0, separator);
const model = selected.slice(separator + 1);
let input = "";
let ending = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  const lines = input.split("\n");
  input = lines.pop() ?? "";
  for (const line of lines) {
    const command: unknown = JSON.parse(line);
    if (typeof command !== "object" || command === null) continue;
    const type: unknown = Reflect.get(command, "type");
    const id: unknown = Reflect.get(command, "id");
    process.stdout.write(`${JSON.stringify({ type: "response", command: type, id, success: true })}\n`);
    if (type === "prompt") {
      process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "tool_execution_start", toolName: "fixture_wait" })}\n`);
    }
  }
});
process.on("SIGTERM", () => {
  if (ending) return;
  ending = true;
  const message = {
    role: "assistant",
    provider,
    model,
    content: [],
    usage: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.15, cacheWrite: 0.05, total: 0.5 },
    },
  };
  process.stdout.write(`${JSON.stringify({ type: "message_end", message })}\n`, () => process.exit(0));
});

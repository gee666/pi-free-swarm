import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityOf,
  createJsonlSplitter,
  dialogRequestId,
  extractUsage,
  extractUserText,
  parseRpcLine,
} from "../../src/agents/rpc-events.js";

test("parseRpcLine keeps objects and drops everything else", () => {
  assert.deepEqual(parseRpcLine('{"type":"agent_start"}'), { type: "agent_start" });
  assert.equal(parseRpcLine("not json"), undefined);
  assert.equal(parseRpcLine("[1,2]"), undefined);
  assert.equal(parseRpcLine("null"), undefined);
});

test("the splitter splits on \\n only, strips \\r and joins multi-byte chunks", () => {
  const lines: string[] = [];
  const splitter = createJsonlSplitter((line) => lines.push(line));
  const text = '{"a":"x\u2028y"}\r\n{"b":"é';
  const bytes = Buffer.from(`${text}"}\n{"c":1}`);
  const cut = Buffer.byteLength(text) - 1; // inside the two-byte "é"
  splitter.push(bytes.subarray(0, cut));
  splitter.push(bytes.subarray(cut));
  assert.deepEqual(lines, ['{"a":"x\u2028y"}', '{"b":"é"}']);
  splitter.end();
  assert.deepEqual(lines.at(-1), '{"c":1}');
});

test("extractUsage reads assistant message_end and compaction_end", () => {
  const usage = { input: 10, output: 49, cacheRead: 3, cacheWrite: 12331, totalTokens: 12393, cost: { total: 0.0157 } };
  assert.deepEqual(
    extractUsage({ type: "message_end", message: { role: "assistant", model: "claude-haiku-4-5", usage } }),
    {
      kind: "message",
      input: 10,
      output: 49,
      cacheRead: 3,
      cacheWrite: 12331,
      cost: 0.0157,
      model: "claude-haiku-4-5",
    },
  );
  assert.deepEqual(extractUsage({ type: "compaction_end", result: { summary: "s", usage } }), {
    kind: "compaction",
    input: 10,
    output: 49,
    cacheRead: 3,
    cacheWrite: 12331,
    cost: 0.0157,
    model: null,
  });
  assert.equal(extractUsage({ type: "message_start", message: { role: "assistant", usage } }), null);
  assert.equal(extractUsage({ type: "message_end", message: { role: "toolResult", usage } }), null);
  assert.equal(extractUsage({ type: "compaction_end", result: null, aborted: true }), null);
});

test("extractUserText joins text blocks of user message_start and tolerates a string", () => {
  const blocks = [
    { type: "text", text: "[swarm message #87] a" },
    { type: "image", data: "…" },
    { type: "text", text: "[swarm message #88] b" },
  ];
  assert.equal(
    extractUserText({ type: "message_start", message: { role: "user", content: blocks } }),
    "[swarm message #87] a\n[swarm message #88] b",
  );
  assert.equal(extractUserText({ type: "message_start", message: { role: "user", content: "plain" } }), "plain");
  assert.equal(extractUserText({ type: "message_end", message: { role: "user", content: "plain" } }), null);
  assert.equal(extractUserText({ type: "message_start", message: { role: "system", content: "" } }), null);
});

test("activityOf maps streaming, tools and settle; other events change nothing", () => {
  assert.deepEqual(activityOf({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } }), {
    kind: "thinking",
  });
  assert.deepEqual(activityOf({ type: "message_update", assistantMessageEvent: { type: "text_start" } }), {
    kind: "writing",
  });
  assert.equal(activityOf({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }), undefined);
  assert.deepEqual(activityOf({ type: "tool_execution_start", toolCallId: "t", toolName: "bash" }), {
    kind: "tool",
    toolName: "bash",
  });
  assert.deepEqual(activityOf({ type: "tool_execution_end", toolCallId: "t" }), { kind: "writing" });
  assert.equal(activityOf({ type: "agent_settled" }), null);
  assert.equal(activityOf({ type: "turn_start" }), undefined);
});

test("dialogRequestId answers only blocking dialog methods", () => {
  for (const method of ["select", "confirm", "input", "editor"]) {
    assert.equal(dialogRequestId({ type: "extension_ui_request", id: "d1", method }), "d1");
  }
  assert.equal(dialogRequestId({ type: "extension_ui_request", id: "n1", method: "notify" }), null);
  assert.equal(dialogRequestId({ type: "extension_ui_request", id: "s1", method: "setStatus" }), null);
  assert.equal(dialogRequestId({ type: "extension_ui_request", method: "confirm" }), null);
  assert.equal(dialogRequestId({ type: "response", id: "d1", method: "confirm" }), null);
});

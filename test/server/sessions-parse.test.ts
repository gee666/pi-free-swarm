import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { SessionItem } from "../../src/api-types.js";
import { SessionReader } from "../../src/server/sessions.js";
import { FIXTURES } from "../fixtures/sessions/helpers.js";

/** Whole fixture, oldest item first, for readable expectations. */
async function fixtureItems(name: string, reader = new SessionReader()): Promise<SessionItem[]> {
  const page = await reader.readPage("Maria", path.join(FIXTURES, name), { limit: 200 });
  assert.equal(page.olderCursor, null);
  return page.items.reverse();
}

function summary(item: SessionItem): string {
  switch (item.kind) {
    case "system":
      return `system/${item.event}`;
    case "swarm_message":
      return `swarm_message #${item.messageId}`;
    case "tool_call":
      return `tool_call ${item.name}`;
    default:
      return item.kind;
  }
}

test("tool calls join their results with error flag and duration; initial model and redacted thinking are skipped", async () => {
  const items = await fixtureItems("tools.jsonl");
  assert.deepEqual(items.map(summary), [
    "user",
    "thinking",
    "assistant_text",
    "tool_call bash",
    "tool_call spike_fail",
    "thinking",
    "assistant_text",
    "system/model_change",
    "user",
    "thinking",
    "assistant_text",
  ]);
  const [bash, fail] = items.filter((item) => item.kind === "tool_call");
  assert.deepEqual(bash, {
    kind: "tool_call",
    id: "d7c1f8f3:2",
    timestamp: Date.parse("2026-09-23T10:54:27.480Z"),
    toolCallId: "toolu_016r1GVWWnJiKairomPFvDQS",
    name: "bash",
    args: { command: "echo hi", timeout: null },
    result: "hi\n",
    resultTruncated: false,
    isError: false,
    durationMs: 17,
  });
  assert.equal(fail.kind === "tool_call" && fail.isError, true);
  assert.equal(fail.kind === "tool_call" && fail.result, "intentional failure");
  assert.equal(fail.kind === "tool_call" && fail.durationMs, 19);
  assert.equal(
    items[0].kind === "user" && items[0].text,
    "Think briefly, then: 1) run bash `echo hi` 2) call spike_fail. Then reply done.",
  );
  assert.deepEqual(items[7], {
    kind: "system",
    id: "914db5a9:0",
    timestamp: Date.parse("2026-09-23T10:54:30.853Z"),
    event: "model_change",
    text: "Model changed to anthropic/claude-haiku-4-5-20251001",
  });
  // The redacted block sits at index 1 of the last assistant entry: its id is not used.
  assert.deepEqual(
    items.slice(-2).map((item) => item.id),
    ["debe5c62:0", "debe5c62:2"],
  );
});

test("retried errors (removed by context_edit) become retry, final and aborted ones error", async () => {
  const items = await fixtureItems("retries.jsonl");
  assert.deepEqual(items.map(summary), [
    "user",
    "system/retry",
    "system/retry",
    "system/error",
    "system/model_change",
    "user",
    "system/error",
    "user",
    "system/error",
    "user",
    "system/error",
    "user",
    "assistant_text",
    "system/error",
  ]);
  assert.deepEqual(items[1], {
    kind: "system",
    id: "eba76fef:0",
    timestamp: Date.parse("2026-09-23T11:00:29.638Z"),
    event: "retry",
    text: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  });
  assert.match(items[3].kind === "system" ? items[3].text : "", /^400 .*fake bad request/);
  assert.deepEqual(items.slice(-2), [
    { kind: "assistant_text", id: "6e2f8b31:0", timestamp: Date.parse("2026-09-23T11:00:42.300Z"), text: "Roses are" },
    {
      kind: "system",
      id: "6e2f8b31:1",
      timestamp: Date.parse("2026-09-23T11:00:42.300Z"),
      event: "error",
      text: "Request was aborted",
    },
  ]);
});

test("compaction becomes one system line with the summarized token count", async () => {
  const items = await fixtureItems("compaction.jsonl");
  const compaction = items.find((item) => item.kind === "system");
  assert.deepEqual(compaction, {
    kind: "system",
    id: "777f891a:0",
    timestamp: Date.parse("2026-09-23T11:01:11.714Z"),
    event: "compaction",
    text: "Context compacted (12,469 tokens summarized)",
  });
  assert.deepEqual(items.map(summary), [
    ...["user", "thinking", "assistant_text"],
    ...["user", "thinking", "assistant_text"],
    ...["user", "thinking", "assistant_text"],
    "system/compaction",
    "user",
    "thinking",
    "assistant_text",
  ]);
});

test("delivered prompts split into swarm messages; revive, resume and plain prompts; other entries emit nothing", async () => {
  const items = await fixtureItems("swarm.jsonl");
  assert.deepEqual(items.map(summary), [
    "user",
    "swarm_message #3",
    "swarm_message #4",
    "thinking",
    "tool_call swarm_read_posts",
    "swarm_message #7",
    "swarm_message #8",
    "swarm_message #9",
    "assistant_text",
    "system/model_change",
    "system/revive",
    "swarm_message #12",
    "assistant_text",
    "user",
    "swarm_message #20",
    "user",
  ]);
  const kickoff = items[0];
  assert.equal(kickoff.kind === "user" && kickoff.text.startsWith("Task for the swarm:\nBuild a CLI todo app"), true);
  assert.equal(kickoff.kind === "user" && kickoff.text.includes("[swarm message"), false);
  assert.deepEqual(items[1], {
    kind: "swarm_message",
    id: "a1000004:1",
    timestamp: Date.parse("2026-09-24T09:00:01.200Z"),
    messageId: 3,
    threadId: 3,
    from: "User",
    to: ["Maria", "You"],
    text: "Please use TypeScript.",
  });
  assert.deepEqual(
    items.slice(5, 8).map((item) => item.id),
    ["a1000007:0", "a1000007:1", "a1000007:2"],
  );
  assert.equal(items[7].kind === "swarm_message" && items[7].from, "Main");
  const tool = items[4];
  assert.equal(tool.kind === "tool_call" && tool.durationMs, 350);
  assert.deepEqual(tool.kind === "tool_call" && tool.args, {});
  assert.equal(items[9].kind === "system" && items[9].text, "Model changed to openai/gpt-5");
  assert.equal(items[10].kind === "system" && items[10].id, "a1000017:0");
  assert.equal(items[13].kind === "user" && items[13].text.startsWith("[swarm resumed by Main]"), true);
  assert.deepEqual(items[14].kind === "swarm_message" && items[14].to, ["Maria", "John", "You"]);
  assert.equal(items[15].kind === "user" && items[15].text, "plain string content");
});

test("tool results are cut at the configured cap", async () => {
  const items = await fixtureItems("tools.jsonl", new SessionReader({ maxToolOutputChars: 5 }));
  const fail = items.find((item) => item.kind === "tool_call" && item.name === "spike_fail");
  assert.equal(fail?.kind === "tool_call" && fail.result, "inten");
  assert.equal(fail?.kind === "tool_call" && fail.resultTruncated, true);
  const bash = items.find((item) => item.kind === "tool_call" && item.name === "bash");
  assert.equal(bash?.kind === "tool_call" && bash.resultTruncated, false);
});

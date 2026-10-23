import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUsage } from "../../src/agents/rpc-events.js";

const usage = {
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 40,
  totalTokens: 100,
  cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0.05, total: 0.25 },
};

test("native tool-result usage is distinct from the worker model and counted only at message_end", () => {
  const finished = {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "fixture",
      model: "other-service/not-the-worker",
      usage,
    },
  };
  const duplicateSource = { type: "tool_execution_end", toolCallId: "call-1", result: { usage } };
  assert.equal(extractUsage(duplicateSource), null);
  assert.equal(extractUsage({ type: "message_start", message: finished.message }), null);
  const sample = extractUsage(finished);
  assert.ok(sample);
  assert.equal(sample.kind, "tool");
  assert.equal(sample.model, null, "native ToolResultMessage has no model attribution to reinterpret");
  assert.equal(sample.cost, 0.25);
  assert.notEqual(sample.costKnown, false);
  assert.deepEqual(sample.costBreakdown, { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0.05 });
  assert.equal(
    [duplicateSource, finished].reduce((total, event) => total + (extractUsage(event)?.cost ?? 0), 0),
    0.25,
  );
});

test("native standalone usage entries count independently without accepting message or compaction copies", () => {
  for (const kind of ["cache_warm", "unknown-operation"]) {
    const sample = extractUsage({
      type: "entry_appended",
      entry: { type: "usage", kind, provider: "fixture", model: "receipt-model-revision", usage },
    });
    assert.ok(sample);
    assert.equal(sample.kind, "usage");
    assert.equal(sample.model, "receipt-model-revision");
    assert.equal(sample.cost, 0.25);
  }
  assert.equal(extractUsage({ type: "entry_appended", entry: { type: "compaction", usage } }), null);
  assert.equal(
    extractUsage({ type: "entry_appended", entry: { type: "message", message: { role: "assistant", usage } } }),
    null,
  );
  assert.equal(extractUsage({ type: "entry_appended", entry: { type: "custom", usage } }), null);
});

test("assistant, tool, compaction and standalone receipts count each native charge exactly once", () => {
  const events = [
    { type: "message_end", message: { role: "assistant", model: "worker", usage } },
    { type: "tool_execution_end", result: { usage } },
    { type: "message_end", message: { role: "toolResult", usage } },
    { type: "compaction_end", reason: "threshold", result: { usage } },
    { type: "entry_appended", entry: { type: "compaction", usage } },
    { type: "entry_appended", entry: { type: "usage", kind: "cache_warm", model: "receipt-model", usage } },
  ];
  const samples = events.flatMap((event) => {
    const sample = extractUsage(event);
    return sample ? [sample] : [];
  });
  assert.deepEqual(
    samples.map((sample) => sample.kind),
    ["message", "tool", "compaction", "usage"],
  );
  assert.equal(
    samples.reduce((total, sample) => total + sample.cost, 0),
    1,
  );
});

test("tool results without usage remain absent; explicit reported zero differs from malformed usage", () => {
  assert.equal(extractUsage({ type: "message_end", message: { role: "toolResult" } }), null);
  assert.equal(extractUsage({ type: "message_end", message: { role: "toolResult", usage: null } }), null);
  const zero = extractUsage({
    type: "message_end",
    message: {
      role: "toolResult",
      usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    },
  });
  assert.ok(zero);
  assert.equal(zero.cost, 0);
  assert.notEqual(zero.costKnown, false);
  const unknown = extractUsage({ type: "message_end", message: { role: "toolResult", usage: { input: 10 } } });
  assert.equal(unknown?.costKnown, false);
  assert.equal(extractUsage({ type: "message_end", message: { role: "user", usage } }), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUsage } from "../../src/agents/rpc-events.js";

for (const kind of ["message", "compaction"]) {
  test(`reported ${kind} costs retain four independent categories`, () => {
    const usage = {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      cost: { input: 0.003, output: 0.004, cacheRead: 0.001, cacheWrite: 0.012, total: 0.02 },
    };
    const event =
      kind === "message"
        ? { type: "message_end", message: { role: "assistant", model: "fixture", usage } }
        : { type: "compaction_end", result: { usage } };
    const sample = extractUsage(event);
    assert.ok(sample);
    assert.equal(sample.cost, 0.02);
    assert.notEqual(sample.costKnown, false);
    assert.deepEqual(sample.costBreakdown, { input: 0.003, output: 0.004, cacheRead: 0.001, cacheWrite: 0.012 });
    assert.equal(sample.cacheRead, 30);
    assert.equal(sample.cacheWrite, 40);
  });
}

test("missing or invalid categories stay unknown without invalidating a reported total", () => {
  const sample = extractUsage({
    type: "message_end",
    message: {
      role: "assistant",
      usage: { cost: { total: 7, input: Number.NaN, output: -1, cacheRead: Infinity, cacheWrite: 0 } },
    },
  });
  assert.ok(sample);
  assert.equal(sample.cost, 7);
  assert.notEqual(sample.costKnown, false);
  assert.deepEqual(sample.costBreakdown, { input: null, output: null, cacheRead: null, cacheWrite: 0 });
  const legacy = extractUsage({ type: "message_end", message: { role: "assistant", usage: { cost: { total: 7 } } } });
  assert.equal(legacy?.costBreakdown, undefined);
});

test("reported components cannot conceal missing total-cost attribution", () => {
  const sample = extractUsage({
    type: "compaction_end",
    result: { usage: { cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  });
  assert.ok(sample);
  assert.equal(sample.costKnown, false);
  assert.equal(sample.cost, 0);
  assert.deepEqual(sample.costBreakdown, { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 });
});

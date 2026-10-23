import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageSample } from "../../src/runtime-types.js";
import { qualifyUsagePricing } from "../../src/broker/usage-pricing.js";

function report(kind: UsageSample["kind"], cost = 0): UsageSample {
  return {
    kind,
    input: 10,
    output: 1,
    cacheRead: 2,
    cacheWrite: 3,
    cost,
    costKnown: true,
    model: "fixture",
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

for (const kind of ["message", "compaction", "usage"] as const) {
  test(`unpriced ${kind} zero and default categories remain unknown`, () => {
    const original = report(kind);
    const qualified = qualifyUsagePricing(original, false);
    assert.equal(qualified.costKnown, false);
    assert.deepEqual(qualified.costBreakdown, { input: null, output: null, cacheRead: null, cacheWrite: null });
    assert.equal(original.costKnown, true, "qualification never mutates a prior report");
    assert.equal(original.costBreakdown?.input, 0);
  });
}

test("missing captured pricing is not evidence that an SDK zero was free", () => {
  assert.equal(qualifyUsagePricing(report("message"), undefined).costKnown, false);
});

test("known pricing preserves a genuine zero and does not repair an already unknown total", () => {
  const known = report("message");
  assert.equal(qualifyUsagePricing(known, true), known);
  const unknown = { ...known, costKnown: false };
  assert.equal(qualifyUsagePricing(unknown, true).costKnown, false);
});

test("tool USD zero is explicit reporting, independent of the worker model catalog", () => {
  const tool = report("tool");
  assert.equal(qualifyUsagePricing(tool, false), tool);
  assert.equal(qualifyUsagePricing(tool, undefined), tool);
});

test("positive reported category subtotals survive an unverified total without new prices", () => {
  const sample = { ...report("usage"), costBreakdown: { input: 0.25, output: 0, cacheRead: null, cacheWrite: 0 } };
  const qualified = qualifyUsagePricing(sample, false);
  assert.equal(qualified.cost, 0);
  assert.deepEqual(qualified.costBreakdown, { input: 0.25, output: null, cacheRead: null, cacheWrite: null });
});

test("a positive reported USD total is not repriced from token counts or current catalog data", () => {
  const sample = report("message", 0.5);
  assert.equal(qualifyUsagePricing(sample, false), sample);
});

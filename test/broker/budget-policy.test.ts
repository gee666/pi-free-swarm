import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeBudgetRaises } from "../../src/budget.js";
import { raiseBudgetPolicy } from "../../src/broker/budget-policy.js";

const current = { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false };

describe("runtime budget raises", () => {
  it("preserves per-swarm raises on resume while honoring higher file ceilings", () => {
    assert.deepEqual(mergeBudgetRaises(current, { moneyUsd: 20 }), { moneyUsd: 20, timeSeconds: 60 });
    assert.deepEqual(mergeBudgetRaises({ moneyUsd: 30, timeSeconds: 120 }, { moneyUsd: 20, timeSeconds: 90 }), {
      moneyUsd: 30,
      timeSeconds: 120,
    });
    assert.deepEqual(mergeBudgetRaises({ moneyUsd: null, timeSeconds: null }, { moneyUsd: 20, timeSeconds: 90 }), {
      moneyUsd: null,
      timeSeconds: null,
    });
    assert.deepEqual(mergeBudgetRaises(current, {}), { moneyUsd: 10, timeSeconds: 60 });
  });
  it("raises total ceilings without mutating existing policy or shutdown mode", () => {
    assert.deepEqual(raiseBudgetPolicy(current, { moneyUsd: 15 }), { ...current, moneyUsd: 15 });
    assert.deepEqual(raiseBudgetPolicy(current, { timeSeconds: 90 }), { ...current, timeSeconds: 90 });
    assert.deepEqual(raiseBudgetPolicy({ ...current, gracefulShutdown: true }, { moneyUsd: 20, timeSeconds: 120 }), {
      moneyUsd: 20,
      timeSeconds: 120,
      gracefulShutdown: true,
    });
    assert.deepEqual(current, { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false });
  });

  it("rejects malformed fields with repair guidance and never partially applies a mixed patch", () => {
    for (const input of [null, false, "20", [], {}, { gracefulShutdown: true }, { budgetMoneyUsd: 20 }]) {
      assert.throws(() => raiseBudgetPolicy(current, input), /budget/);
    }
    for (const value of [undefined, null, false, "20", 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => raiseBudgetPolicy(current, { moneyUsd: value }), /moneyUsd must be a finite positive/);
      assert.throws(() => raiseBudgetPolicy(current, { timeSeconds: value }), /timeSeconds must be a finite positive/);
    }
    assert.throws(() => raiseBudgetPolicy(current, { moneyUsd: 10 }), /must exceed its current total ceiling/);
    assert.throws(() => raiseBudgetPolicy(current, { moneyUsd: 20, timeSeconds: 30 }), /timeSeconds must exceed/);
    assert.deepEqual(current, { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false });
  });

  it("does not turn an unlimited dimension into an enforced limit or change its meaning", () => {
    const unlimitedMoney = { ...current, moneyUsd: null };
    assert.throws(() => raiseBudgetPolicy(unlimitedMoney, { moneyUsd: 100 }), /already unlimited/);
    assert.deepEqual(raiseBudgetPolicy(unlimitedMoney, { timeSeconds: 120 }), { ...unlimitedMoney, timeSeconds: 120 });
    assert.throws(
      () => raiseBudgetPolicy({ ...current, timeSeconds: null }, { timeSeconds: 100 }),
      /already unlimited/,
    );
  });
});

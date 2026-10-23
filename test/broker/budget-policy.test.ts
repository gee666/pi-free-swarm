import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeBudgetRaises } from "../../src/budget.js";
import { raiseBudgetPolicy } from "../../src/broker/budget-policy.js";

const current = { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false };

describe("runtime budget edits", () => {
  it("preserves explicit per-swarm ceilings on resume over file ceilings", () => {
    assert.deepEqual(mergeBudgetRaises(current, { moneyUsd: 20 }), { moneyUsd: 20, timeSeconds: 60 });
    assert.deepEqual(mergeBudgetRaises({ moneyUsd: 30, timeSeconds: 120 }, { moneyUsd: 20, timeSeconds: 90 }), {
      moneyUsd: 20,
      timeSeconds: 90,
    });
    assert.deepEqual(mergeBudgetRaises({ moneyUsd: null, timeSeconds: null }, { moneyUsd: 20, timeSeconds: 90 }), {
      moneyUsd: 20,
      timeSeconds: 90,
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
    assert.throws(
      () => raiseBudgetPolicy(current, { moneyUsd: 20, timeSeconds: 0 }),
      /timeSeconds must be a finite positive/,
    );
    assert.deepEqual(current, { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false });
  });

  it("lowers finite ceilings and sets finite ceilings on unlimited dimensions", () => {
    assert.deepEqual(raiseBudgetPolicy(current, { moneyUsd: 2, timeSeconds: 30 }), {
      ...current,
      moneyUsd: 2,
      timeSeconds: 30,
    });
    const unlimited = { ...current, moneyUsd: null, timeSeconds: null };
    assert.deepEqual(raiseBudgetPolicy(unlimited, { moneyUsd: 5 }), { ...unlimited, moneyUsd: 5 });
    assert.deepEqual(raiseBudgetPolicy(unlimited, { timeSeconds: 20 }), { ...unlimited, timeSeconds: 20 });
    assert.deepEqual(unlimited, { moneyUsd: null, timeSeconds: null, gracefulShutdown: false });
  });
});

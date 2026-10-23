import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { recordUsage } from "../../src/broker/agent-state.js";
import { raiseSwarmBudget } from "../../src/broker/budget-policy.js";
import { assertBudgetPricing } from "../../src/broker/budget.js";
import { configureRun } from "../../src/broker/run-configuration.js";
import { DEFAULT_TIMINGS, type RunEnvironment } from "../../src/broker/run-types.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import type { UsageSample } from "../../src/runtime-types.js";
import { systemClock } from "../../src/clock.js";
import { loadSettings } from "../../src/settings.js";
import { checkUsageAccounting, hasBudgetAccountingGap, readBudget } from "../../src/store/budget.js";
import { hasUnverifiedUsageCost } from "../../src/store/usage-provenance.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

function fixture() {
  const { id } = seedSwarm(temp.db);
  const env: RunEnvironment = {
    cwd: temp.cwd,
    db: temp.db,
    runnerPid: process.pid,
    clock: { ...systemClock, now: () => T0 },
    settings: { ...loadSettings(temp.cwd, { globalFile: null }).settings, budgetMoneyUsd: 1 },
    launch: {
      extensionArgs: [],
      projectTrusted: false,
      model: { provider: "fixture", modelId: "worker", thinkingLevel: "off" },
    },
    availableModels: [{ provider: "fixture", id: "worker", thinkingLevels: ["off"], pricingKnown: true }],
    boardUrl: () => null,
    notifyUser: () => undefined,
  };
  const assignments = configureRun(env, id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
  return { id, env, assignments };
}

function oldWriter(id: number, cost: number) {
  temp.db.sql
    .prepare(
      "INSERT INTO usage (swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at) VALUES (?, 'Maria', 1, 'message', 10, 10, 0, 0, ?, 'worker', ?)",
    )
    .run(id, cost, T0);
}

describe("reported total-cost provenance", () => {
  it("refuses legacy zero on money admission and live raises without inventing an amount", () => {
    const { id, env, assignments } = fixture();
    oldWriter(id, 0);
    assert.equal(hasUnverifiedUsageCost(temp.db, id), true);
    assert.equal(
      hasBudgetAccountingGap(temp.db, id),
      true,
      "the insertion invariant also protects an already-admitted owner",
    );
    assert.throws(() => assertBudgetPricing(env, assignments, id), /accounting is incomplete/);
    assert.throws(() => raiseSwarmBudget(temp.db, id, { moneyUsd: 2 }, 0, T0, 1), /cannot repair unknown costs/);
    assert.equal(readBudget(temp.db, id, env.settings, T0).costUsd, 0);
    assert.equal(
      temp.db.sql.prepare("SELECT COUNT(*) AS n FROM configuration_requests WHERE swarm_id = ?").get(id)?.n,
      0,
    );
  });

  it("preserves newly explicit reported zero and positive legacy writes omitting the new column", () => {
    const known = fixture();
    recordUsage(
      temp.db,
      known.id,
      "Maria",
      { kind: "message", input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 0, model: "worker" },
      T0,
    );
    assert.equal(
      temp.db.sql.prepare("SELECT cost_reported FROM usage WHERE swarm_id = ?").get(known.id)?.cost_reported,
      1,
    );
    assert.equal(hasUnverifiedUsageCost(temp.db, known.id), false);
    assert.doesNotThrow(() => assertBudgetPricing(known.env, known.assignments, known.id));
    const legacy = fixture();
    oldWriter(legacy.id, 0.25);
    assert.equal(
      temp.db.sql.prepare("SELECT cost_reported FROM usage WHERE swarm_id = ?").get(legacy.id)?.cost_reported,
      null,
    );
    assert.equal(hasUnverifiedUsageCost(temp.db, legacy.id), false);
    assert.equal(hasBudgetAccountingGap(temp.db, legacy.id), false);
    assert.doesNotThrow(() => assertBudgetPricing(legacy.env, legacy.assignments, legacy.id));
  });

  it("marks an explicitly missing total atomically and deduplicates its gap without repricing", () => {
    const { id } = fixture();
    const missing: UsageSample = {
      kind: "message",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      costKnown: false,
      model: "worker",
    };
    recordUsage(temp.db, id, "Maria", missing, T0);
    recordUsage(temp.db, id, "Maria", missing, T0);
    assert.equal(hasUnverifiedUsageCost(temp.db, id), true);
    assert.equal(
      temp.db.sql
        .prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = ? AND agent = 'Maria'")
        .get(id)?.n,
      1,
    );
    const rolled = fixture();
    assert.throws(
      () =>
        temp.db.write(() => {
          recordUsage(temp.db, rolled.id, "Maria", missing, T0);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(hasUnverifiedUsageCost(temp.db, rolled.id), false);
    assert.equal(hasBudgetAccountingGap(temp.db, rolled.id), false);
  });

  it("allows an explicitly agreed unlimited resume without erasing historical uncertainty", () => {
    const { id, env } = fixture();
    oldWriter(id, 0);
    endRun(temp.db, id, process.pid, "stopped", T0 + 1000, 1);
    beginResume(temp.db, id, process.pid, T0 + 2000);
    env.settings.budgetMoneyUsd = undefined;
    const assignments = configureRun(env, id, 2, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    assert.doesNotThrow(() => assertBudgetPricing(env, assignments, id));
    assert.equal(hasUnverifiedUsageCost(temp.db, id), true);
    assert.equal(readBudget(temp.db, id, env.settings, T0 + 2000).moneyUsd, null);
  });

  it("does not mistake known service receipts for a worker model change", () => {
    const { id } = fixture();
    const kinds: readonly UsageSample["kind"][] = ["tool", "usage"];
    for (const kind of kinds) {
      const sample = { kind, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.25, model: "service-model" };
      recordUsage(temp.db, id, "Maria", sample, T0);
      assert.equal(checkUsageAccounting(temp.db, id, "Maria", sample, T0), undefined);
    }
    assert.equal(hasBudgetAccountingGap(temp.db, id), false);
  });

  it("uses the narrow unknown-provenance index only at the explicit guard boundary", () => {
    const { id } = fixture();
    const rows = temp.db.sql
      .prepare(
        "EXPLAIN QUERY PLAN SELECT 1 FROM usage WHERE swarm_id = ? AND (cost_reported = 0 OR (cost_reported IS NULL AND cost <= 0)) LIMIT 1",
      )
      .all(id);
    assert.ok(rows.some((row) => typeof row.detail === "string" && row.detail.includes("usage_unverified_cost")));
  });
});

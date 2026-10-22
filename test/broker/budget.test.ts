import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { assertBudgetPricing, readBudget, recordBudgetStop } from "../../src/broker/budget.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

describe("cumulative budget accounting", () => {
  it("rejects missing pricing for every controlled model without fallback", () => {
    const model = { provider: "fixture", modelId: "worker", thinkingLevel: null };
    const env = {
      settings: { ...loadSettings(temp.cwd).settings, budgetMoneyUsd: 1 },
      launch: { extensionArgs: [], projectTrusted: false, model },
      availableModels: [{ provider: "fixture", id: "worker", thinkingLevels: [], pricingKnown: false }],
    };
    assert.throws(() => assertBudgetPricing(env, new Map([["Maria", model]])), /requires known USD pricing/);
    env.availableModels[0].pricingKnown = true;
    assert.doesNotThrow(() => assertBudgetPricing(env, new Map([["Maria", model]])));
    assert.throws(() => assertBudgetPricing(env, new Map([["Maria", { ...model, modelId: "unknown" }]])), /unknown/);
  });
  it("excludes stopped time and treats increased limits as total ceilings", () => {
    const swarm = seedSwarm(temp.db);
    const policy = { budgetTimeSeconds: 2 };
    assert.equal(readBudget(temp.db, swarm.id, policy, T0 + 1999).exhausted, null);
    assert.equal(readBudget(temp.db, swarm.id, policy, T0 + 2000).exhausted, "time");
    recordBudgetStop(temp.db, swarm.id, 1, "time", T0 + 2100);
    endRun(temp.db, swarm.id, process.pid, "stopped", T0 + 2100, 1);
    assert.equal(readBudget(temp.db, swarm.id, policy, T0 + 90000).activeTimeMs, 2100);
    beginResume(temp.db, swarm.id, process.pid, T0 + 90000);
    const raised = readBudget(temp.db, swarm.id, { budgetTimeSeconds: 3 }, T0 + 90500);
    assert.equal(raised.activeTimeMs, 2600);
    assert.equal(raised.exhausted, null);
    assert.equal(raised.stopReason, null);
    assert.equal(raised.gracefulShutdown, false);
  });

  it("counts reported usage across runs and exposes overshoot without votes", () => {
    const swarm = seedSwarm(temp.db);
    temp.db.sql
      .prepare(
        "INSERT INTO usage (swarm_id, agent, run, kind, input, output, cache_read, cache_write, cost, created_at) VALUES (?, 'Maria', 1, 'message', 1, 1, 0, 0, 1.25, ?)",
      )
      .run(swarm.id, T0);
    const status = readBudget(temp.db, swarm.id, { budgetMoneyUsd: 1, gracefulShutdownOnBudget: true }, T0);
    assert.equal(status.exhausted, "money");
    assert.equal(status.moneyOvershootUsd, 0.25);
    assert.equal(status.gracefulShutdown, true);
    recordBudgetStop(temp.db, swarm.id, 1, "money", T0);
    recordBudgetStop(temp.db, swarm.id, 1, "money", T0);
    assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM budget_stops WHERE swarm_id = ?").get(swarm.id)?.n, 1);
    assert.equal(
      temp.db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ?").get(swarm.id)?.n,
      0,
    );
  });
});

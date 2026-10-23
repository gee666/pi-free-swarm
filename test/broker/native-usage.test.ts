import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUsage } from "../../src/agents/rpc-events.js";
import { createAgentHooks } from "../../src/broker/agent-hooks.js";
import { configureRun } from "../../src/broker/run-configuration.js";
import { hasBudgetAccountingGap } from "../../src/store/budget.js";
import { agentUsageTotals } from "../../src/store/stats-queries.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, createRunFixture, FAST } from "../integration/run-fixture.js";

const usage = {
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 40,
  totalTokens: 100,
  cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0.05, total: 0.25 },
};

test("native nonassistant fee receipts count without false model fallback or assistant turns", () => {
  const fixture = createRunFixture(SCENARIOS.settle);
  try {
    const swarm = seedSwarm(fixture.db);
    const env = { ...fixture.env, settings: { ...fixture.env.settings, budgetMoneyUsd: 10 } };
    configureRun(env, swarm.id, 1, agentNames(fixture.db, swarm.id), FAST);
    const hooks = createAgentHooks({
      db: fixture.db,
      swarmId: swarm.id,
      run: 1,
      name: "Maria",
      clock: env.clock,
      isEnding: () => false,
      onCrash() {},
    });
    const tool = extractUsage({ type: "message_end", message: { role: "toolResult", usage } });
    const standalone = extractUsage({
      type: "entry_appended",
      entry: { type: "usage", kind: "cache_warm", provider: "fixture", model: "concrete-receipt-revision", usage },
    });
    assert.ok(tool && standalone);
    hooks.onUsage(tool);
    hooks.onUsage(standalone);
    assert.equal(hasBudgetAccountingGap(fixture.db, swarm.id), false);
    const total = agentUsageTotals(fixture.db, swarm.id, "Maria");
    assert.equal(total.cost, 0.5);
    assert.equal(total.turns, 0);
    assert.equal(total.cacheRead, 60);
    assert.equal(total.cacheWrite, 80);
    assert.equal(total.costBreakdown?.records, 2);
    assert.deepEqual(
      fixture.db.sql
        .prepare("SELECT kind, model, cost_reported FROM usage ORDER BY id")
        .all()
        .map((row) => ({ ...row })),
      [
        { kind: "tool", model: null, cost_reported: 1 },
        { kind: "usage", model: "concrete-receipt-revision", cost_reported: 1 },
      ],
    );
    const assistant = extractUsage({
      type: "message_end",
      message: { role: "assistant", model: "wrong-worker-model", usage },
    });
    assert.ok(assistant);
    assert.throws(() => hooks.onUsage(assistant), /model|enforce/i);
    assert.equal(hasBudgetAccountingGap(fixture.db, swarm.id), true, "real assistant-model mismatch remains guarded");
  } finally {
    fixture.cleanup();
  }
});

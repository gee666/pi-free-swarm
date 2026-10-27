import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, createRunFixture, newestSwarmId, reviveCount } from "./run-fixture.js";

test("reported usage before a crash and recovery compaction share one money ceiling", { timeout: 15_000 }, async () => {
  const run = createRunFixture({
    spawns: [
      {
        runs: [
          [
            { type: "reply", usage: { input: 10, output: 2, cost: 0.004 } },
            { type: "exit", code: 3 },
          ],
        ],
      },
      SCENARIOS.compaction,
    ],
  });
  const env = {
    ...run.env,
    settings: { ...run.env.settings, budgetMoneyUsd: 0.007 },
    availableModels: [{ provider: "fixture", id: "test", thinkingLevels: ["off"], pricingKnown: true }],
  };
  const cancel = new AbortController();
  const running = startSwarm(
    env,
    {
      name: "budget-recovery",
      taskPrompt: "Verify reported recovery accounting.",
      acceptanceCriteria: ["Attributable recovery and compaction usage are cumulative."],
      agentAmount: 1,
    },
    { signal: cancel.signal },
  );
  const swarmId = newestSwarmId(run.db);
  const [name] = agentNames(run.db, swarmId);
  try {
    const outcome = await running;
    assert.equal(outcome.stopReason, "budget-exhausted");
    assert.ok(outcome.budget);
    assert.equal(outcome.budget.exhausted, "money");
    // Recovery reports its normal reply plus compaction, in addition to pre-crash usage.
    assert.ok(Math.abs(outcome.budget.costUsd - 0.009) < Number.EPSILON);
    assert.ok(outcome.budget.moneyOvershootUsd > 0);
    assert.equal(reviveCount(run.db, swarmId, name), 1);
  } finally {
    cancel.abort();
    await running;
    run.cleanup();
  }
});

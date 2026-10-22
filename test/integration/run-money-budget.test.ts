import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { createRunFixture, newestSwarmId, voteAll, waitForWorkersIdle } from "./run-fixture.js";

test(
  "reported real-child money usage stops at the total ceiling and persists across approved increase",
  { timeout: 15_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    const env = {
      ...run.env,
      settings: { ...run.env.settings, budgetMoneyUsd: 0.005 },
      availableModels: [{ provider: "fixture", id: "test", thinkingLevels: ["off"], pricingKnown: true }],
    };
    const cancel = new AbortController();
    const first = startSwarm(
      env,
      {
        name: "money-budget",
        taskPrompt: "Use only local fixtures.",
        acceptanceCriteria: ["Reported usage remains cumulative."],
        agentAmount: 1,
      },
      { signal: cancel.signal },
    );
    const swarmId = newestSwarmId(run.db);
    try {
      const stopped = await first;
      assert.equal(stopped.stopReason, "budget-exhausted");
      assert.ok(stopped.budget);
      assert.equal(stopped.budget.exhausted, "money");
      assert.equal(stopped.budget.costUsd, 0.01);
      assert.equal(stopped.budget.moneyOvershootUsd, 0.005);
      assert.equal(stopped.acceptance.counts.accepted, 0);
      const resumedEnv = { ...env, settings: { ...env.settings, budgetMoneyUsd: 0.03 } };
      const resumeCancel = new AbortController();
      const resumed = resumeSwarm(
        resumedEnv,
        { swarmId, message: "User approved a total ceiling of USD 0.03." },
        { signal: resumeCancel.signal },
      );
      try {
        await waitForWorkersIdle(run, swarmId);
        voteAll(run.db, swarmId, "accepted", "Local money fixture verified");
        const completed = await resumed;
        assert.equal(completed.end, "finished");
        assert.equal(completed.stopReason, undefined);
        assert.equal(completed.budget?.moneyUsd, 0.03);
        assert.equal(completed.budget?.costUsd, 0.02);
      } finally {
        resumeCancel.abort();
        await resumed;
      }
    } finally {
      cancel.abort();
      await first;
      run.cleanup();
    }
  },
);

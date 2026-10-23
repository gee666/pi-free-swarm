import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getStats } from "../../src/store/stats-queries.js";
import { createRunFixture, newestSwarmId, waitFor } from "./run-fixture.js";

test(
  "reported tool-result USD counts once toward the worker money ceiling without extra turns",
  { timeout: 10_000 },
  async () => {
    const fixture = createRunFixture({
      runs: [
        [
          { type: "tool", ms: 10, usage: { input: 31, output: 7, cacheRead: 11, cacheWrite: 13, cost: 0.7 } },
          { type: "reply", usage: { input: 2, output: 1, cost: 0.4 } },
          { type: "silence" },
        ],
      ],
    });
    const controller = new AbortController();
    const running = startSwarm(
      {
        ...fixture.env,
        settings: { ...fixture.env.settings, budgetMoneyUsd: 1 },
        availableModels: [{ provider: "fixture", id: "test", thinkingLevels: ["off"], pricingKnown: true }],
      },
      {
        name: "reported-tool-cost",
        taskPrompt: "Count reported tool usage without a second bill or assistant turn.",
        acceptanceCriteria: ["Observable tool-result cost triggers the existing cumulative money stop exactly once."],
        agentAmount: 1,
      },
      { signal: controller.signal },
    );
    const swarmId = newestSwarmId(fixture.db);
    try {
      await waitFor(
        () =>
          fixture.db.sql.prepare("SELECT 1 FROM usage WHERE swarm_id = ? AND kind = 'tool'").get(swarmId) !== undefined,
        "reported tool usage persists",
        5_000,
      );
      const outcome = await running;
      assert.equal(outcome.stopReason, "budget-exhausted");
      assert.equal(outcome.end, "stopped");
      assert.equal(outcome.acceptance.verdict, "unchecked");
      assert.equal(outcome.acceptance.votes.length, 0, "budget exhaustion does not manufacture a vote");
      const rows = fixture.db.sql
        .prepare("SELECT cost, input, output, cache_read, cache_write FROM usage WHERE swarm_id = ? AND kind = 'tool'")
        .all(swarmId);
      assert.equal(rows.length, 1, "tool_execution_end does not double-count the final toolResult message");
      assert.deepEqual({ ...rows[0] }, { cost: 0.7, input: 31, output: 7, cache_read: 11, cache_write: 13 });
      const stats = getStats(fixture.db, swarmId, Date.now());
      assert.ok(stats);
      assert.equal(stats.totals.turns, 2, "only the two assistant messages are turns");
      assert.equal(stats.totals.input, 43);
      assert.equal(stats.totals.output, 13);
      assert.equal(stats.totals.cacheRead, 11);
      assert.equal(stats.totals.cacheWrite, 13);
      assert.ok(Math.abs(stats.totals.cost - 1.101) < 1e-9);
    } finally {
      controller.abort();
      try {
        await running;
      } finally {
        fixture.cleanup();
      }
    }
  },
);

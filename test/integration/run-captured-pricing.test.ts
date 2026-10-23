import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeSwarm, startSwarm, type RunEnvironment } from "../../src/broker/swarm-run.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { createRunFixture, newestSwarmId, spawnsOf, waitForWorkersIdle, type RunFixture } from "./run-fixture.js";

function environment(fixture: RunFixture, pricingKnown: boolean, money?: number): RunEnvironment {
  return {
    ...fixture.env,
    settings: { ...fixture.env.settings, ...(money === undefined ? {} : { budgetMoneyUsd: money }) },
    availableModels: [{ provider: "fixture", id: "test", thinkingLevels: ["off"], pricingKnown }],
  };
}
const task = {
  taskPrompt: "Preserve captured pricing provenance without repricing historical zeros.",
  acceptanceCriteria: ["Only genuine known zero or explicit tool USD is trusted, not an unpriced model zero."],
  agentAmount: 1,
};

function gapCount(fixture: RunFixture, swarmId: number): number {
  return Number(
    fixture.db.sql.prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = ?").get(swarmId)?.n,
  );
}

test("an unpriced zero stays unknown when a later resume has known pricing", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture({ runs: [[{ type: "reply", usage: { input: 1, output: 1, cost: 0 } }]] });
  const controller = new AbortController();
  const running = startSwarm(
    environment(fixture, false),
    { ...task, name: "captured-unknown-zero" },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  try {
    await waitForWorkersIdle(fixture, swarmId);
    const row = fixture.db.sql
      .prepare("SELECT cost_reported FROM usage WHERE swarm_id = ? AND kind = 'message'")
      .get(swarmId);
    assert.equal(row?.cost_reported, 0);
    assert.ok(gapCount(fixture, swarmId) > 0);
    controller.abort();
    await running;
    const before = spawnsOf(fixture.fake).length;
    await assert.rejects(
      resumeSwarm(
        environment(fixture, true, 1),
        { swarmId, message: "Pricing is now configured; do not pretend old unknown costs were free." },
        {},
      ),
      /accounting|incomplete/i,
    );
    assert.equal(
      spawnsOf(fixture.fake).length,
      before,
      "current catalog prices do not repair or launch over an unknown historical zero",
    );
  } finally {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

test("mixed workers capture pricing evidence from their own assigned spec", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture({ runs: [[{ type: "reply", usage: { input: 1, output: 1, cost: 0 } }]] });
  const controller = new AbortController();
  const env: RunEnvironment = {
    ...fixture.env,
    settings: {
      ...fixture.env.settings,
      models: [
        { provider: "fixture", model: "priced", thinkingLevel: "off" },
        { provider: "fixture", model: "unpriced", thinkingLevel: "off" },
      ],
    },
    availableModels: [
      { provider: "fixture", id: "priced", thinkingLevels: ["off"], pricingKnown: true },
      { provider: "fixture", id: "unpriced", thinkingLevels: ["off"], pricingKnown: false },
    ],
  };
  const running = startSwarm(
    env,
    { ...task, name: "captured-mixed-zero", agentAmount: 2 },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  try {
    await waitForWorkersIdle(fixture, swarmId);
    const workers = getRunConfiguration(fixture.db, swarmId)?.effective.workers;
    assert.ok(workers);
    for (const worker of workers) {
      const row = fixture.db.sql
        .prepare("SELECT cost_reported FROM usage WHERE swarm_id = ? AND agent = ? AND kind = 'message'")
        .get(swarmId, worker.name);
      assert.equal(row?.cost_reported, worker.modelId === "priced" ? 1 : 0);
    }
    assert.equal(gapCount(fixture, swarmId), 1);
  } finally {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

test("captured known pricing preserves a genuine reported model zero", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture({ runs: [[{ type: "reply", usage: { input: 0, output: 0, cost: 0 } }]] });
  const controller = new AbortController();
  const running = startSwarm(
    environment(fixture, true, 1),
    { ...task, name: "captured-known-zero" },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  try {
    await waitForWorkersIdle(fixture, swarmId);
    const row = fixture.db.sql
      .prepare("SELECT cost_reported FROM usage WHERE swarm_id = ? AND kind = 'message'")
      .get(swarmId);
    assert.equal(row?.cost_reported, 1);
    assert.equal(gapCount(fixture, swarmId), 0);
  } finally {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

test("explicit tool USD zero does not inherit an unpriced model's uncertainty", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture({
    runs: [
      [
        { type: "tool", ms: 10, usage: { input: 1, output: 0, cost: 0 } },
        { type: "reply", usage: { cost: 0.001 } },
      ],
    ],
  });
  const controller = new AbortController();
  const running = startSwarm(
    environment(fixture, false),
    { ...task, name: "captured-tool-zero" },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  try {
    await waitForWorkersIdle(fixture, swarmId);
    const row = fixture.db.sql
      .prepare("SELECT cost_reported FROM usage WHERE swarm_id = ? AND kind = 'tool'")
      .get(swarmId);
    assert.equal(row?.cost_reported, 1);
    assert.equal(gapCount(fixture, swarmId), 0);
  } finally {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

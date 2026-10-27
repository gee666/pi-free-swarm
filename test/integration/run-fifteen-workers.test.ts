import { finishWork } from "../helpers/finish-work.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, createRunFixture, isAlive, newestSwarmId, spawnsOf, waitForWorkersIdle } from "./run-fixture.js";

test("full runtime admits exactly 15 real workers and finishes from the work graph", { timeout: 30_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  const env = { ...run.env, settings: { ...run.env.settings, maxAgents: 15 } };
  const cancel = new AbortController();
  const running = startSwarm(
    env,
    {
      name: "fifteen-runtime",
      taskPrompt: "Verify the requested full team without resizing.",
      acceptanceCriteria: ["Exactly fifteen real fixture workers start and the work graph completes."],
      agentAmount: 15,
    },
    { signal: cancel.signal },
  );
  const swarmId = newestSwarmId(run.db);
  try {
    await waitForWorkersIdle(run, swarmId);
    const names = agentNames(run.db, swarmId);
    assert.equal(names.length, 15);
    assert.equal(spawnsOf(run.fake).length, 15);
    assert.equal(getRunConfiguration(run.db, swarmId)?.effective.workers.length, 15);
    const modes = run.fake.log().filter((record) => record.type === "set_steering_mode");
    assert.ok(modes.length >= 15);
    assert.ok(modes.every((record) => record.mode === "all"));
    finishWork(run.db, swarmId);
    const completed = await running;
    assert.equal(completed.end, "finished");

    const childPids = run.fake
      .log()
      .filter((record) => record.fake === "spawn")
      .map((record) => Number(record.pid));
    assert.ok(
      childPids.every((pid) => !isAlive(pid)),
      "joined runtime shutdown reaps workers and Watcher",
    );
  } finally {
    cancel.abort();
    try {
      await running;
    } finally {
      run.cleanup();
    }
  }
});

import { finishWork } from "../helpers/finish-work.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { RunControls } from "../../src/broker/run-controls.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../../src/store/runtime-configuration.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { createRunFixture, isAlive, newestSwarmId, spawnsOf, waitFor, waitForWorkersIdle } from "./run-fixture.js";

test(
  "pending control work coalesces completion scans without adding a second wakeup queue",
  { timeout: 10_000 },
  async () => {
    const fixture = createRunFixture(SCENARIOS.settle);
    const clock = new FakeClock();
    const controller = new AbortController();
    const running = startSwarm(
      { ...fixture.env, clock },
      {
        name: "coalesced-completion",
        taskPrompt: "Keep only one completion scan waiting on controls.",
        acceptanceCriteria: ["Pending control work does not accumulate redundant post-control scans."],
        agentAmount: 1,
      },
      { signal: controller.signal },
    );
    const swarmId = newestSwarmId(fixture.db);
    clock.advance(0);
    const originalControls = RunControls.prototype.update;
    const originalReminders = IdleReminders.prototype.update;
    let release: () => void = () => {
      throw new Error("Control barrier not initialized");
    };
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let scans = 0;
    try {
      await waitForWorkersIdle(fixture, swarmId);
      RunControls.prototype.update = () => pending;
      IdleReminders.prototype.update = function (this: IdleReminders) {
        scans++;
        return originalReminders.call(this);
      };
      clock.advance(1000);
      assert.equal(scans, 0);
      release();
      await waitFor(() => scans > 0, "one post-control scan finishes");
      assert.equal(scans, 1);
    } finally {
      release();
      RunControls.prototype.update = originalControls;
      IdleReminders.prototype.update = originalReminders;
      controller.abort();
      try {
        await running;
      } finally {
        fixture.cleanup();
      }
    }
  },
);

test("work-graph completion takes priority over an unclaimed addition", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture(SCENARIOS.settle);
  const clock = new FakeClock();
  const controller = new AbortController();
  const running = startSwarm(
    { ...fixture.env, clock },
    {
      name: "completion-before-control",
      taskPrompt: "Do not let an unclaimed edit defer completion.",
      acceptanceCriteria: ["The completed work graph closes before a queued worker addition is admitted."],
      agentAmount: 1,
    },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  clock.advance(0);
  try {
    await waitForWorkersIdle(fixture, swarmId);
    finishWork(fixture.db, swarmId);
    const request = queueConfigurationChange(
      fixture.db,
      swarmId,
      "User",
      { type: "addAgents", count: 1 },
      0,
      clock.now(),
      1,
    );
    clock.advance(25);
    assert.equal((await running).outcome, "completed");

    assert.equal(spawnsOf(fixture.fake).length, 1);
    const view = getRuntimeConfiguration(fixture.db, swarmId, clock.now());
    assert.equal(view?.configuration?.effective.workers.length, 1);
    assert.equal(view?.requests.find((entry) => entry.id === request.id)?.status, "rejected");
  } finally {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

test("work-graph completion stops workers while control work is still held", { timeout: 10_000 }, async () => {
  const fixture = createRunFixture(SCENARIOS.settle);
  const clock = new FakeClock();
  const controller = new AbortController();
  const running = startSwarm(
    { ...fixture.env, clock },
    {
      name: "completion-during-control",
      taskPrompt: "Do not let a held control defer work-graph completion.",
      acceptanceCriteria: ["The unchanged work-graph completion closes admission before the control barrier releases."],
      agentAmount: 1,
    },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  clock.advance(0);
  const original = RunControls.prototype.update;
  let release: () => void = () => {
    throw new Error("Control barrier not initialized");
  };
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await waitForWorkersIdle(fixture, swarmId);
    const [child] = spawnsOf(fixture.fake);
    assert.ok(child);
    RunControls.prototype.update = () => pending;
    clock.advance(25);
    finishWork(fixture.db, swarmId);
    clock.advance(25);
    const sealed = fixture.db.sql
      .prepare("SELECT admission_closed_run AS closed_run FROM swarms WHERE id = ?")
      .get(swarmId);
    assert.equal(sealed?.closed_run, 1, "completion closes admission without waiting for controls");
    await waitFor(() => !isAlive(child.pid), "completion interrupts the child before controls release");
  } finally {
    release();
    RunControls.prototype.update = original;
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
  }
});

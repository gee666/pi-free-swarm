import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../../src/store/runtime-configuration.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { killFixtureChild } from "./control-child-cleanup.js";
import {
  agentNames,
  createRunFixture,
  isAlive,
  newestSwarmId,
  waitFor,
  waitForWorkersIdle,
  voteAll,
} from "./run-fixture.js";

test("stopped unclaimed controls are visibly rejected and never replayed on resume", { timeout: 15_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  const cancel = new AbortController();
  const running = startSwarm(
    run.env,
    {
      name: "unclaimed-control",
      taskPrompt: "Preserve explicit control status.",
      acceptanceCriteria: ["Old controls are not replayed."],
      agentAmount: 1,
    },
    { signal: cancel.signal },
  );
  const swarmId = newestSwarmId(run.db);
  try {
    await waitForWorkersIdle(run, swarmId);
    const original = agentNames(run.db, swarmId);
    const request = queueConfigurationChange(
      run.db,
      swarmId,
      "User",
      { type: "addAgents", count: 1 },
      0,
      Date.now(),
      1,
    );
    cancel.abort();
    await running;
    const stopped = getRuntimeConfiguration(run.db, swarmId, Date.now())?.requests.find(
      (item) => item.id === request.id,
    );
    assert.equal(stopped?.status, "rejected");
    assert.match(stopped?.error ?? "", /Run ended before this control started/);
    const resumeCancel = new AbortController();
    const resumed = resumeSwarm(
      run.env,
      { swarmId, message: "Continue without replaying old controls." },
      { signal: resumeCancel.signal },
    );
    try {
      await waitForWorkersIdle(run, swarmId);
      assert.deepEqual(agentNames(run.db, swarmId), original);
      assert.equal(
        getRuntimeConfiguration(run.db, swarmId, Date.now())?.requests.find((item) => item.id === request.id)?.status,
        "rejected",
      );
      voteAll(run.db, swarmId, "accepted", "Control status verified");
      assert.equal((await resumed).end, "finished");
    } finally {
      resumeCancel.abort();
      await resumed;
    }
  } finally {
    cancel.abort();
    try {
      await running;
    } finally {
      run.cleanup();
    }
  }
});

test(
  "immediate budget interruption proceeds while a removed child still awaits cleanup",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture({ spawns: [{ ...SCENARIOS.settle, ignoreSigterm: true }, SCENARIOS.settle] });
    const clock = new FakeClock();
    const env = {
      ...run.env,
      clock,
      settings: { ...run.env.settings, budgetTimeSeconds: 1, gracefulShutdownOnBudget: false },
    };
    const cancel = new AbortController();
    const running = startSwarm(
      env,
      {
        name: "pending-control-budget",
        taskPrompt: "Do not let cleanup delay supported budget interruption.",
        acceptanceCriteria: ["Healthy work is interrupted at budget exhaustion despite pending removal cleanup."],
        agentAmount: 2,
      },
      { signal: cancel.signal },
    );
    const swarmId = newestSwarmId(run.db);
    const names = agentNames(run.db, swarmId);
    clock.advance(0);
    try {
      await waitForWorkersIdle(run, swarmId);
      const pid = (name: string) => {
        const spawn = run.fake.log().find((record) => record.fake === "spawn" && record.agent === name);
        assert.ok(spawn && typeof spawn.pid === "number");
        return spawn.pid;
      };
      const retiringPid = pid(names[0]);
      const healthyPid = pid(names[1]);
      queueConfigurationChange(run.db, swarmId, "User", { type: "removeAgent", name: names[0] }, 0, clock.now(), 1);
      clock.advance(25);
      await waitFor(
        () => run.fake.log().some((record) => record.fake === "signal" && record.agent === names[0]),
        "removal SIGTERM observed",
      );
      assert.equal(isAlive(retiringPid), true, "removal cleanup is genuinely still pending");
      clock.advance(975);
      await waitFor(() => !isAlive(healthyPid), "budget interrupts healthy child before removed child joins");
      assert.ok(run.notes.some((note) => note.includes("budget exhausted")));
      assert.equal(isAlive(retiringPid), true, "budget did not wait for this cleanup to complete");
      killFixtureChild(retiringPid);
      const outcome = await running;
      assert.equal(outcome.stopReason, "budget-exhausted");
      assert.equal(outcome.end, "stopped");
    } finally {
      cancel.abort();
      for (const spawn of run.fake.log().filter((record) => record.fake === "spawn")) {
        if (typeof spawn.pid === "number" && isAlive(spawn.pid)) killFixtureChild(spawn.pid);
      }
      try {
        await running;
      } finally {
        run.cleanup();
      }
    }
  },
);

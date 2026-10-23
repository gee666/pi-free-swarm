import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as flushTasks } from "node:timers/promises";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../../src/store/runtime-configuration.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, agentStatus, createRunFixture, isAlive, newestSwarmId, spawnsOf, waitFor } from "./run-fixture.js";

async function drainingFixture(count: number) {
  const fixture = createRunFixture(SCENARIOS.longTool(60_000));
  const clock = new FakeClock();
  const controller = new AbortController();
  const running = startSwarm(
    {
      ...fixture.env,
      clock,
      settings: {
        ...fixture.env.settings,
        budgetTimeSeconds: 1,
        gracefulShutdownOnBudget: true,
      },
    },
    {
      name: "graceful-terminal",
      taskPrompt: "Keep terminal votes and explicit removal live during draining.",
      acceptanceCriteria: ["A graceful budget wait does not delay valid quorum or administrative removal."],
      agentAmount: count,
    },
    { signal: controller.signal },
  );
  const swarmId = newestSwarmId(fixture.db);
  const names = agentNames(fixture.db, swarmId);
  clock.advance(0);
  try {
    await waitFor(
      () => names.every((name) => agentStatus(fixture.db, swarmId, name) === "working"),
      "workers executing active turns",
    );
    const children = spawnsOf(fixture.fake);
    assert.equal(children.length, count);
    clock.advance(1000);
    await waitFor(
      () => fixture.notes.some((note) => note.includes("budget exhausted")),
      "graceful budget draining begins",
    );
    assert.ok(
      children.every((child) => isAlive(child.pid)),
      "graceful exhaustion alone leaves active operations running",
    );
    return { fixture, clock, controller, running, swarmId, names, children };
  } catch (error) {
    controller.abort();
    try {
      await running;
    } finally {
      fixture.cleanup();
    }
    throw error;
  }
}

async function stop(state: Awaited<ReturnType<typeof drainingFixture>>) {
  state.controller.abort();
  try {
    await state.running;
  } finally {
    state.fixture.cleanup();
  }
}

for (const verdict of ["accepted", "blocked"] as const) {
  test(`${verdict} quorum interrupts active work during graceful budget draining`, { timeout: 10_000 }, async () => {
    const state = await drainingFixture(1);
    try {
      mutateAcceptance(
        state.fixture.db,
        state.swarmId,
        state.names[0],
        {
          action: "vote",
          verdict,
          reason: "The whole-task outcome has been checked while the operation remains active.",
        },
        state.clock.now(),
      );
      state.clock.advance(25);
      await waitFor(
        () => state.children.every((child) => !isAlive(child.pid)),
        "terminal quorum interrupts active work",
      );
      const outcome = await state.running;
      assert.equal(outcome.acceptance.verdict, verdict);
      assert.equal(outcome.end, "stopped");
      assert.equal(outcome.stopReason, "budget-exhausted", "the earlier recorded execution stop reason is retained");
    } finally {
      await stop(state);
    }
  });
}

test("owned removal stays live while draining but new-work admission stays blocked", { timeout: 10_000 }, async () => {
  const state = await drainingFixture(2);
  try {
    await flushTasks();
    const removal = queueConfigurationChange(
      state.fixture.db,
      state.swarmId,
      "User",
      {
        type: "removeAgent",
        name: state.names[0],
      },
      0,
      state.clock.now(),
      1,
    );
    state.clock.advance(25);
    await waitFor(
      () =>
        getRuntimeConfiguration(state.fixture.db, state.swarmId, state.clock.now())?.requests.some(
          (request) => request.id === removal.id && request.status === "applied",
        ) === true,
      "removal joins during drain",
    );
    assert.equal(agentStatus(state.fixture.db, state.swarmId, state.names[0]), "retired");
    assert.equal(agentStatus(state.fixture.db, state.swarmId, state.names[1]), "working");
    await flushTasks();
    const addition = queueConfigurationChange(
      state.fixture.db,
      state.swarmId,
      "User",
      {
        type: "addAgents",
        count: 1,
      },
      1,
      state.clock.now(),
      1,
    );
    state.clock.advance(25);
    await waitFor(
      () =>
        getRuntimeConfiguration(state.fixture.db, state.swarmId, state.clock.now())?.requests.some(
          (request) => request.id === addition.id && request.status === "rejected",
        ) === true,
      "new-work control is rejected",
    );
    assert.equal(spawnsOf(state.fixture.fake).length, 2);
    assert.equal(
      getRuntimeConfiguration(state.fixture.db, state.swarmId, state.clock.now())?.configuration?.effective.workers
        .length,
      1,
    );
  } finally {
    await stop(state);
  }
});

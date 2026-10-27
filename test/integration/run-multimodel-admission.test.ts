import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { SCENARIOS, type FakePiScenario } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  isAlive,
  finishWork,
  waitFor,
  waitForWorkersIdle,
  type RunFixture,
} from "./run-fixture.js";

function setup() {
  const f = createRunFixture({}, { timings: { reviveBackoffMs: [500] } });
  f.env.settings.models = [
    { provider: "a", model: "one", thinkingLevel: "off" },
    { provider: "b", model: "two", thinkingLevel: "high" },
  ];
  f.env.availableModels = [
    { provider: "a", id: "one", thinkingLevels: ["off"] },
    { provider: "b", id: "two", thinkingLevels: ["high"] },
  ];
  const outcome = startSwarm(
    f.env,
    {
      name: "per-model readiness",
      taskPrompt: "Verify grouped admission.",
      acceptanceCriteria: ["Each assigned model validates its own launch path."],
      agentAmount: 4,
    },
    {},
  );
  // Launch timers have not run yet, so scenario names can be bound to the actual allocated slots.
  const id = newestSwarmId(f.db);
  const names = agentNames(f.db, id);
  assert.equal(names.length, 4);
  return { f, outcome, id, names };
}

function scenario(f: RunFixture, names: readonly string[], second: FakePiScenario): void {
  const file = f.fake.env.FAKE_PI_SCENARIO;
  assert.ok(file);
  const agents: Record<string, FakePiScenario> = { [WATCHER_NAME]: {} };
  for (const name of names) agents[name] = { runs: [[{ type: "reply" }]] };
  const firstSecondGroup = names[2];
  assert.ok(firstSecondGroup);
  agents[firstSecondGroup] = second;
  writeFileSync(file, JSON.stringify({ agents }));
}

function count(f: RunFixture, name: string | undefined): number {
  return f.fake.log().filter((row) => row.fake === "spawn" && row.agent === name).length;
}

it(
  "readiness for one model does not admit peers of another model before its real ready signal",
  { timeout: 20_000 },
  async () => {
    const { f, outcome, id, names } = setup();
    const release = path.join(f.fake.dir, "ready-second-model");
    scenario(f, names, { startup: [{ type: "waitForFile", file: release }], runs: [[{ type: "reply" }]] });
    try {
      await waitFor(
        () => count(f, names[1]) === 1 && count(f, names[2]) === 1,
        "first group released and second group starting",
      );
      assert.equal(agentStatus(f.db, id, names[2]), "starting");
      assert.equal(count(f, names[3]), 0, "other model's ready signal cannot release this group");
      writeFileSync(release, "ready");
      await waitForWorkersIdle(f, id);
      assert.equal(count(f, names[3]), 1);
      finishWork(f.db, id);
      assert.equal((await outcome).end, "finished");
    } finally {
      await stopAllRuns();
      await outcome.catch(() => undefined);
      f.cleanup();
    }
  },
);

it(
  "a fatal second-model startup stops admission and joins the already healthy model children",
  { timeout: 20_000 },
  async () => {
    const { f, outcome, names } = setup();
    const release = path.join(f.fake.dir, "fail-second-model");
    scenario(f, names, {
      startup: [{ type: "waitForFile", file: release }, ...(SCENARIOS.extensionLoadFailure.startup ?? [])],
    });
    try {
      await waitFor(
        () => count(f, names[1]) === 1 && count(f, names[2]) === 1,
        "healthy model released before fatal model failure",
      );
      writeFileSync(release, "fail");
      await assert.rejects(outcome, /shared startup.*Failed to load extension/);
      assert.equal(count(f, names[0]), 1);
      assert.equal(count(f, names[1]), 1);
      assert.equal(count(f, names[2]), 1);
      assert.equal(count(f, names[3]), 0);
      for (const launch of f.fake.log().filter((row) => row.fake === "spawn")) {
        assert.equal(isAlive(Number(launch.pid)), false, "fatal startup returns only after joined child cleanup");
      }
    } finally {
      await stopAllRuns();
      await outcome.catch(() => undefined);
      f.cleanup();
    }
  },
);

it(
  "a transient second-model failure keeps its peers gated until bounded real-worker recovery",
  { timeout: 20_000 },
  async () => {
    const { f, outcome, id, names } = setup();
    const fail = path.join(f.fake.dir, "transient-failure");
    const recover = path.join(f.fake.dir, "release-recovery");
    scenario(f, names, {
      startup: [
        { type: "waitForFile", file: fail },
        { type: "exit", code: 3, stderr: "temporary fixture failure" },
      ],
    });
    try {
      await waitFor(() => count(f, names[2]) === 1, "second-model first attempt waiting");
      assert.equal(count(f, names[3]), 0);
      scenario(f, names, { startup: [{ type: "waitForFile", file: recover }], runs: [[{ type: "reply" }]] });
      writeFileSync(fail, "fail");
      await waitFor(() => count(f, names[2]) === 2, "second-model bounded real recovery started");
      assert.equal(count(f, names[3]), 0, "recovery spawn alone cannot release its peer");
      writeFileSync(recover, "ready");
      await waitForWorkersIdle(f, id);
      assert.equal(count(f, names[2]), 2, "one bounded actual recovery, no paid health probe");
      assert.equal(count(f, names[3]), 1);
      assert.equal(count(f, names[0]), 1, "unrelated healthy worker is not restarted");
      finishWork(f.db, id);
      assert.equal((await outcome).end, "finished");
    } finally {
      await stopAllRuns();
      await outcome.catch(() => undefined);
      f.cleanup();
    }
  },
);

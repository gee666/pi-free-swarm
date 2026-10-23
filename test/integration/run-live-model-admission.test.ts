import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { startSwarm, type RunOutcome } from "../../src/broker/swarm-run.js";
import { getConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../../src/store/runtime-configuration.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS, type FakePiScenario } from "../fixtures/fake-pi/harness.js";
import {
  agentStatus,
  createRunFixture,
  isAlive,
  newestSwarmId,
  spawnsOf,
  waitFor,
  waitForWorkersIdle,
} from "./run-fixture.js";

it(
  "a fatal newly added model gate isolates its pending peers while healthy original and added workers continue",
  { timeout: 20_000 },
  async () => {
    const f = createRunFixture(SCENARIOS.settle);
    const cancel = new AbortController();
    f.env.launch.model = { provider: "a", modelId: "one", thinkingLevel: "off" };
    f.env.settings.models = [
      { provider: "a", model: "one", thinkingLevel: "off" },
      { provider: "b", model: "two", thinkingLevel: "high" },
    ];
    f.env.settings.maxAgents = 6;
    f.env.availableModels = [
      { provider: "a", id: "one", thinkingLevels: ["off"] },
      { provider: "b", id: "two", thinkingLevels: ["high"] },
    ];
    const release = path.join(f.fake.dir, "fatal-live-model");
    const scenario: FakePiScenario = {
      ...SCENARIOS.settle,
      agents: { Watcher: {} },
      models: {
        "b/two": {
          startup: [{ type: "waitForFile", file: release }, ...(SCENARIOS.extensionLoadFailure.startup ?? [])],
        },
      },
    };
    const scenarioFile = f.fake.env.FAKE_PI_SCENARIO;
    assert.ok(scenarioFile);
    writeFileSync(scenarioFile, JSON.stringify(scenario));
    let ended: RunOutcome | undefined;
    let failure: unknown;
    const running = startSwarm(
      f.env,
      {
        name: "live-model-gate",
        taskPrompt: "Keep healthy workers active during live additions.",
        acceptanceCriteria: ["An added model's confirmed fatal startup does not stop unrelated workers."],
        agentAmount: 1,
      },
      { signal: cancel.signal },
    );
    void running.then(
      (outcome) => {
        ended = outcome;
      },
      (error: unknown) => {
        failure = error;
      },
    );
    try {
      const id = newestSwarmId(f.db);
      await waitForWorkersIdle(f, id);
      const original = spawnsOf(f.fake)[0];
      assert.ok(original);
      const request = queueConfigurationChange(
        f.db,
        id,
        "User",
        { type: "addAgents", count: 5 },
        getConfigurationRevision(f.db, id),
        Date.now(),
      );
      await waitFor(() => {
        if (failure) throw failure;
        if (ended) throw new Error("Live admission unexpectedly stopped the run");
        return (
          getRuntimeConfiguration(f.db, id, Date.now())?.requests.find((item) => item.id === request.id)?.status ===
          "applied"
        );
      }, "live slots recorded");
      const workers = getRunConfiguration(f.db, id)?.effective.workers ?? [];
      const healthy = workers.filter((worker) => worker.provider === "a");
      const addedGroup = workers.filter((worker) => worker.provider === "b");
      assert.equal(healthy.length, 3);
      assert.equal(addedGroup.length, 3);
      const spawnsFor = (name: string) =>
        f.fake.log().filter((record) => record.fake === "spawn" && record.agent === name);
      await waitFor(
        () =>
          healthy.every((worker) => agentStatus(f.db, id, worker.name) === "idle") &&
          addedGroup.some((worker) => spawnsFor(worker.name).length === 1),
        "known-ready workers continue before new model gate",
      );
      assert.equal(
        addedGroup.flatMap((worker) => spawnsFor(worker.name)).length,
        1,
        "new model peers remain gated before readiness",
      );
      writeFileSync(release, "fail");
      await waitFor(
        () => addedGroup.every((worker) => agentStatus(f.db, id, worker.name) === "crashed"),
        "fatal model group is visible and isolated",
      );
      assert.equal(
        addedGroup.flatMap((worker) => spawnsFor(worker.name)).length,
        1,
        "no doomed peer launches or health probes",
      );
      for (const worker of healthy) {
        assert.equal(agentStatus(f.db, id, worker.name), "idle");
        const [spawn] = spawnsFor(worker.name);
        assert.ok(spawn);
        assert.equal(spawnsFor(worker.name).length, 1, "healthy workers are not restarted");
        assert.equal(isAlive(Number(spawn.pid)), true);
      }
      assert.equal(isAlive(original.pid), true);
      assert.equal(spawnsOf(f.fake).length, 4);
      assert.equal(getSwarm(f.db, id, Date.now())?.status, "running");
      assert.equal(getSwarm(f.db, id, Date.now())?.agentAmount, 6, "crashed active workers stay in the denominator");
      assert.ok(f.notes.some((note) => note.includes("Healthy unrelated workers continue")));
      assert.equal(ended, undefined);
      cancel.abort();
      assert.equal((await running).end, "stopped");
      for (const spawn of spawnsOf(f.fake)) assert.equal(isAlive(spawn.pid), false);
    } finally {
      cancel.abort();
      await running.catch(() => undefined);
      f.cleanup();
    }
  },
);

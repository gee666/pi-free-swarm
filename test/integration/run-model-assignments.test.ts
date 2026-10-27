import assert from "node:assert/strict";
import { it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { resumeSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  createRunFixture,
  newestSwarmId,
  recipientStatus,
  finishWork,
  waitForWorkersIdle,
} from "./run-fixture.js";

function flag(argv: unknown, key: string): string | undefined {
  if (!Array.isArray(argv)) return undefined;
  const strings = argv.map(String);
  const index = strings.indexOf(key);
  return index < 0 ? undefined : strings[index + 1];
}

it(
  "real mixed-model children retain named assignments and offline messages across explicit resume",
  { timeout: 30_000 },
  async () => {
    const f = createRunFixture(SCENARIOS.settle);
    try {
      f.env.availableModels = [
        { provider: "a", id: "one", thinkingLevels: ["off"] },
        { provider: "b", id: "two", thinkingLevels: ["high"] },
      ];
      f.env.settings.models = [
        { provider: "a", model: "one", thinkingLevel: "off", count_proportional: 2 },
        { provider: "b", model: "two", thinkingLevel: "high" },
      ];
      const first = startSwarm(
        f.env,
        { name: "mixed", taskPrompt: "Check models.", acceptanceCriteria: ["Models checked."], agentAmount: 5 },
        {},
      );
      const id = newestSwarmId(f.db);
      await waitForWorkersIdle(f, id);
      const names = agentNames(f.db, id);
      const target = names[4];
      assert.ok(target);
      const message = sendMessage(f.db, {
        swarmId: id,
        from: "User",
        to: target,
        text: "Inspect saved evidence before repeating work.",
        now: Date.now(),
      });
      assert.equal(recipientStatus(f.db, message.id, target), "pending");
      await stopAllRuns();
      assert.equal((await first).end, "stopped");
      assert.equal(recipientStatus(f.db, message.id, target), "pending");
      const saved = getRunConfiguration(f.db, id, 1);
      assert.deepEqual(
        saved?.effective.workers.map((worker) => worker.modelId),
        ["one", "one", "one", "two", "two"],
      );
      f.env.settings.models = [{ provider: "b", model: "two", thinkingLevel: "high" }];
      const second = resumeSwarm(f.env, { swarmId: id, message: "Continue with saved assignments." }, {});
      await waitForWorkersIdle(f, id);
      assert.equal(recipientStatus(f.db, message.id, target), "read");
      finishWork(f.db, id);
      assert.equal((await second).end, "finished");
      const launches = f.fake.log().filter((row) => row.fake === "spawn" && row.agent !== WATCHER_NAME);
      assert.equal(launches.length, 10);
      for (const worker of saved?.effective.workers ?? []) {
        const matching = launches.filter((row) => row.agent === worker.name);
        assert.equal(matching.length, 2);
        for (const launch of matching) {
          assert.equal(flag(launch.argv, "--model"), `${worker.provider}/${worker.modelId}`);
          assert.equal(flag(launch.argv, "--thinking"), worker.thinkingLevel);
        }
      }
      assert.ok(f.notes.some((note) => note.includes("Keeping each worker's recorded")));
    } finally {
      await stopAllRuns();
      f.cleanup();
    }
  },
);

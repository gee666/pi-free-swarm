import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createCriterion } from "../../src/broker/criteria.js";
import { readRunOwnership } from "../../src/broker/run-ownership.js";
import { readProject } from "../../src/broker/project.js";
import { onWorkChanged } from "../../src/broker/work-write.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { createRunFixture, newestSwarmId, finishWork, waitForWorkersIdle, waitFor, spawnsOf } from "./run-fixture.js";

test(
  "User scope change during completion drain keeps the same run alive and restarts its workers",
  { timeout: 30_000 },
  async () => {
    const f = createRunFixture(SCENARIOS.settle);
    let remove = () => {};
    try {
      const pending = startSwarm(
        f.env,
        { name: "Drain race", taskPrompt: "Deliver", acceptanceCriteria: ["Works"], agentAmount: 2 },
        {},
      );
      const swarmId = newestSwarmId(f.db);
      await waitForWorkersIdle(f, swarmId);
      let injected = false;
      remove = onWorkChanged((id) => {
        if (id !== swarmId || injected || readRunOwnership(f.db, id, 1, process.pid) !== "closed") return;
        injected = true;
        createCriterion(f.db, {
          swarmId,
          actor: "User",
          now: Date.now(),
          group: "Drain",
          title: "One more requirement",
          body: "User changed scope during shutdown",
          verification: "Check output",
          source: "",
        });
      });
      finishWork(f.db, swarmId);
      assert.equal(injected, true);
      await waitFor(() => spawnsOf(f.fake).length === 4, "workers relaunched");
      await waitForWorkersIdle(f, swarmId);
      assert.equal(getSwarm(f.db, swarmId, Date.now())?.runCount, 1);
      assert.equal(readProject(f.db, swarmId).outcome, null);
      finishWork(f.db, swarmId);
      const result = await pending;
      assert.equal(result.end, "finished");
      assert.equal(result.run, 1);
      assert.equal(result.outcome, "completed");
    } finally {
      remove();
      await stopAllRuns();
      f.cleanup();
    }
  },
);

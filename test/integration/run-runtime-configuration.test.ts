import assert from "node:assert/strict";
import { test } from "node:test";
import { finishWork } from "../helpers/finish-work.js";
import { createPost } from "../../src/broker/wall.js";
import { activeWorkerNames, getActiveAssignments } from "../../src/store/active-roster.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { getPost } from "../../src/store/wall-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentStatus, createRunFixture, isAlive, waitFor } from "./run-fixture.js";

for (const initialCount of [5, 2]) {
  test(
    `cross-process live roster controls preserve votes, slots and cleanup from ${initialCount} workers`,
    { timeout: 40_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle);
      const owner = await configurationOwner(run, initialCount);
      const { swarmId } = owner;
      try {
        await waitFor(
          () => activeWorkerNames(run.db, swarmId).every((name) => agentStatus(run.db, swarmId, name) === "idle"),
          "initial real workers idle",
          15_000,
        );
        const original = getActiveAssignments(run.db, swarmId);
        assert.equal(original.length, initialCount);
        const initialConfiguration = run.db.sql
          .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1")
          .get(swarmId)?.configuration;
        if (initialCount === 2) {
          await owner.applied({ type: "addAgents", count: 2 });
          await waitFor(
            () =>
              activeWorkerNames(run.db, swarmId).length === 4 &&
              activeWorkerNames(run.db, swarmId).every((name) => agentStatus(run.db, swarmId, name) === "idle"),
            "added real workers idle",
            15_000,
          );
          const assignments = getActiveAssignments(run.db, swarmId);

          for (const assignment of original)
            assert.deepEqual(
              assignments.find((worker) => worker.name === assignment.name),
              assignment,
            );
          assert.ok(
            assignments.every(
              (worker) => worker.provider === "fixture" && worker.modelId === "test" && worker.thinkingLevel === "off",
            ),
          );
          for (const worker of assignments) {
            const spawn = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === worker.name);
            assert.ok(spawn && Array.isArray(spawn.argv));
            const argv = spawn.argv.map(String);
            assert.equal(argv[argv.indexOf("--model") + 1], `${worker.provider}/${worker.modelId}`);
            assert.equal(argv[argv.indexOf("--thinking") + 1], worker.thinkingLevel);
          }

          const added = assignments.filter((worker) => !original.some((old) => old.name === worker.name));
          await owner.applied({ type: "removeAgent", name: added[0].name });

          await owner.applied({ type: "removeAgent", name: added[1].name });
        } else {
          const removed = original[4].name;
          const history = createPost(
            run.db,
            swarmId,
            removed,
            { title: "Preserved evidence", text: "Do not delete this worker's history." },
            Date.now(),
          );

          const spawned = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === removed);
          assert.ok(spawned && typeof spawned.pid === "number");
          await owner.applied({ type: "removeAgent", name: removed });
          assert.equal(isAlive(spawned.pid), false, "applied removal means child cleanup was joined");
          assert.equal(getPost(run.db, swarmId, history.id)?.author, removed);
        }
        finishWork(run.db, swarmId);
        await owner.finished();
        assert.equal(getSwarm(run.db, swarmId, Date.now())?.status, "finished");
        assert.equal(
          run.db.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1").get(swarmId)
            ?.configuration,
          initialConfiguration,
          "initial provenance is immutable",
        );
        assert.ok(run.fake.log().some((entry) => entry.type === "set_steering_mode" && entry.mode === "all"));
      } finally {
        await owner.close();
        run.cleanup();
      }
    },
  );
}

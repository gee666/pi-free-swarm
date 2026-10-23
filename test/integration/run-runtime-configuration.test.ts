import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { createPost } from "../../src/broker/wall.js";
import { activeWorkerNames, getActiveAssignments } from "../../src/store/active-roster.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { getPost } from "../../src/store/wall-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentStatus, createRunFixture, isAlive, waitFor } from "./run-fixture.js";

function vote(
  run: ReturnType<typeof createRunFixture>,
  swarmId: number,
  name: string,
  verdict: "accepted" | "incomplete",
) {
  return mutateAcceptance(
    run.db,
    swarmId,
    name,
    { action: "vote", verdict, reason: `Retain ${name}'s ${verdict} evidence.` },
    Date.now(),
  );
}

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
          vote(run, swarmId, original[0].name, "accepted");
          await owner.applied({ type: "addAgents", count: 2 });
          await waitFor(
            () =>
              activeWorkerNames(run.db, swarmId).length === 4 &&
              activeWorkerNames(run.db, swarmId).every((name) => agentStatus(run.db, swarmId, name) === "idle"),
            "added real workers idle",
            15_000,
          );
          const assignments = getActiveAssignments(run.db, swarmId);
          assert.equal(inspectAcceptance(run.db, swarmId).counts.accepted, 1, "addition retains existing judgments");
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
          vote(run, swarmId, original[1].name, "accepted");
          assert.deepEqual(
            [inspectAcceptance(run.db, swarmId).counts.accepted, inspectAcceptance(run.db, swarmId).threshold],
            [2, 3],
          );
          const added = assignments.filter((worker) => !original.some((old) => old.name === worker.name));
          await owner.applied({ type: "removeAgent", name: added[0].name });
          assert.equal(inspectAcceptance(run.db, swarmId).verdict, "incomplete");
          assert.throws(() => vote(run, swarmId, added[0].name, "accepted"), /Removed workers cannot vote/);
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
          vote(run, swarmId, removed, "incomplete");
          for (const worker of original.slice(0, 3)) vote(run, swarmId, worker.name, "accepted");
          assert.deepEqual(
            [inspectAcceptance(run.db, swarmId).counts.accepted, inspectAcceptance(run.db, swarmId).threshold],
            [3, 4],
          );
          const spawned = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === removed);
          assert.ok(spawned && typeof spawned.pid === "number");
          await owner.applied({ type: "removeAgent", name: removed });
          assert.equal(isAlive(spawned.pid), false, "applied removal means child cleanup was joined");
          assert.equal(getPost(run.db, swarmId, history.id)?.author, removed);
          assert.equal(
            run.db.sql
              .prepare("SELECT reason FROM acceptance_votes WHERE swarm_id = ? AND agent = ?")
              .get(swarmId, removed)?.reason,
            `Retain ${removed}'s incomplete evidence.`,
          );
        }
        await owner.finished();
        const acceptance = inspectAcceptance(run.db, swarmId);
        assert.equal(acceptance.verdict, "accepted");
        assert.equal(acceptance.totalAgents, initialCount === 2 ? 2 : 4);
        assert.equal(acceptance.counts.accepted, initialCount === 2 ? 2 : 3);
        assert.equal(acceptance.counts.incomplete, 0, "retired vote remains historical, not in the active tally");
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

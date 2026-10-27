import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { readProject } from "../../src/broker/project.js";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { getCriterionDetail } from "../../src/broker/work-queries.js";
import { listCriteria } from "../../src/store/criteria.js";
import { listTasks } from "../../src/store/tasks.js";
import { createRunFixture, newestSwarmId, waitFor } from "./run-fixture.js";

for (const blocked of [false, true]) {
  const expected = blocked ? "stopped_with_blockers" : "completed";
  test(`fake Pi peers reach ${expected} without User input`, { timeout: 20_000 }, async () => {
    const run = createRunFixture({
      runs: [
        [
          { type: "work_graph", blocked },
          { type: "reply", text: "Graph updated" },
        ],
      ],
    });
    const running = startSwarm(
      run.env,
      {
        name: "peer-graph",
        taskPrompt: "Implement and verify",
        acceptanceCriteria: ["The requirement is verified"],
        agentAmount: 2,
      },
      {},
    );
    const swarmId = newestSwarmId(run.db);
    try {
      await waitFor(() => evaluateCompletion(run.db, swarmId).done, "peer work completes autonomously", 15_000);
      assert.ok(listTasks(run.db, swarmId).every((task) => task.status === (blocked ? "claimed" : "accepted")));
      if (blocked) {
        for (const criterion of listCriteria(run.db, swarmId)) {
          const detail = getCriterionDetail(run.db, swarmId, criterion.id);
          assert.equal(detail.status, "blocked");
          assert.ok(detail.votes.filter((vote) => !vote.stale && vote.verdict === "blocked").length >= 2);
        }
      }
      const result = await running;
      assert.equal(result.end, "finished");
      assert.equal(result.outcome, expected);
      assert.equal(readProject(run.db, swarmId).outcome, expected);
      assert.ok(evaluateCompletion(run.db, swarmId).gates.every((gate) => gate.ok));
    } finally {
      await stopAllRuns();
      await running;
      run.cleanup();
    }
  });
}

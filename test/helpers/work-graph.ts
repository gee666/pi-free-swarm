import type { TestContext } from "node:test";
import { createCriterion } from "../../src/broker/criteria.js";
import { createTask } from "../../src/broker/tasks.js";
import { claimTask } from "../../src/broker/task-ownership.js";
import { startTask } from "../../src/broker/task-transitions.js";
import { beginTaskReview } from "../../src/broker/task-review.js";
import { finishReview } from "./task-review.js";
import { listCriteria } from "../../src/store/criteria.js";
import { getTask, listTasks } from "../../src/store/tasks.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { createTempDb, seedSwarm, T0 } from "./temp-db.js";

export function workFixture(t: TestContext) {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db, { agents: ["Ann", "Ben", "Cam", "Dan"] });
  let now = T0;
  const input = (actor = "Ann") => ({ swarmId: swarm.id, actor, now: ++now });
  const criterion = createCriterion(temp.db, {
    ...input(),
    group: "Delivery",
    title: "Works",
    body: "The feature works.",
    verification: "Run tests.",
    source: "brief.md",
  });
  const task = (criterionId = criterion.id, dependsOn: readonly number[] = [], claim = false) =>
    createTask(temp.db, {
      ...input(),
      title: "Implement",
      body: "Implement and test the feature.",
      criteria: [{ criterionId, contribution: "Implementation and tests" }],
      dependsOn,
      claim,
    });
  const accept = (id: number, owner = "Ann") => {
    const current = getTask(temp.db, swarm.id, id);
    if (current?.status === "new") claimTask(temp.db, { ...input(owner), id });
    startTask(temp.db, { ...input(owner), id });
    beginTaskReview(temp.db, { ...input(owner), id, context: "src/feature.ts; npm test passed" });
    return finishReview(temp.db, { ...input(owner), id, verdict: "accept", reason: "Verified tests and diff." });
  };
  const settle = () => {
    for (const criterion of listCriteria(temp.db, swarm.id)) {
      if (
        !listTasks(temp.db, swarm.id).some((task) =>
          temp.db.sql
            .prepare("SELECT 1 FROM task_criteria WHERE task_id = ? AND criterion_id = ?")
            .get(task.id, criterion.id),
        )
      )
        task(criterion.id);
    }
    for (const task of listTasks(temp.db, swarm.id)) if (task.status !== "accepted") accept(task.id);
    for (const criterion of listCriteria(temp.db, swarm.id)) {
      voteCriterion(temp.db, { ...input(), criterionId: criterion.id, verdict: "covered", reason: "Verified." });
      voteCriterion(temp.db, {
        ...input("Ben"),
        criterionId: criterion.id,
        verdict: "covered",
        reason: "Independent check.",
      });
    }
  };
  return { ...temp, swarmId: swarm.id, input, criterion, task, accept, settle };
}

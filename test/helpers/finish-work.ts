import { createTask } from "../../src/broker/tasks.js";
import { claimTask } from "../../src/broker/task-ownership.js";
import { requestTaskReview, reviewTask, startTask } from "../../src/broker/task-transitions.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { approveScope } from "../../src/broker/project.js";
import { listCriteria, criterionTasks } from "../../src/store/criteria.js";
import { listTasks } from "../../src/store/tasks.js";
import { listParticipants } from "../../src/store/swarm-queries.js";
import type { SwarmDb } from "../../src/store/db.js";

export function finishWork(db: SwarmDb, swarmId: number, approve = true): void {
  const owner = listParticipants(db, swarmId).find((p) => p.kind === "agent" && p.name !== "Watcher" && !["crashed", "stopped", "retired"].includes(p.status))?.name ?? "User";
  const input = (actor = owner) => ({ swarmId, actor, now: Date.now() });
  db.write(() => {
    for (const criterion of listCriteria(db, swarmId)) {
      if (!criterionTasks(db, criterion.id).length) createTask(db, { ...input(), title: "Verify requirement", body: "Check required output", criteria: [{ criterionId: criterion.id, contribution: "Verification" }] });
    }
    for (const task of listTasks(db, swarmId)) {
      if (task.status === "accepted") continue;
      const actor = task.owner ?? owner;
      if (task.status === "new") claimTask(db, { ...input(actor), id: task.id });
      if (["new", "claimed"].includes(task.status)) startTask(db, { ...input(actor), id: task.id });
      if (task.status !== "review") requestTaskReview(db, { ...input(actor), id: task.id, evidence: "Fixture checks passed" });
      const reviewer = actor === "User" ? owner : "User";
      reviewTask(db, { ...input(reviewer), id: task.id, verdict: "accept", reason: "Independent fixture verification" });
    }
    for (const criterion of listCriteria(db, swarmId)) {
      const owners = new Set(criterionTasks(db, criterion.id).flatMap((task) => task.owner ? [task.owner] : []));
      for (const actor of owners) voteCriterion(db, { ...input(actor), criterionId: criterion.id, verdict: "satisfied", reason: "Output checked" });
      voteCriterion(db, { ...input("User"), criterionId: criterion.id, verdict: "satisfied", reason: "Independent fixture verification" });
    }
    if (approve) approveScope(db, input("User"));
  });
}

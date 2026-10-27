import type { TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { taskWaiting } from "../store/tasks.js";
import { workRoster } from "../store/work-roster.js";
import { BrokerError } from "./errors.js";
import type { TaskActionInput } from "./task-ownership.js";
import { commitTask, dependencyNotifications, requireOwner, requireStatus } from "./task-write.js";
import { storedWorkText } from "./work-text.js";
import { checkRevision, isActiveOwner, requireTask } from "./work-validation.js";
import { chooseWorkRecipient, notifyWork } from "./work-notifications.js";
import { writeWork } from "./work-write.js";

export function startTask(db: SwarmDb, input: TaskActionInput): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    requireOwner(task, actor);
    requireStatus(task, "claimed");
    if (taskWaiting(db, task.id))
      throw new BrokerError(
        "validation",
        `Task #${task.id} is waiting. All dependencies must be accepted before start.`,
      );
    return commitTask(db, input, { ...task, status: "in_progress" }, actor, "started");
  });
}
export function requestTaskReview(db: SwarmDb, input: TaskActionInput & { evidence: string }): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    requireOwner(task, actor);
    requireStatus(task, "in_progress");
    const evidence = storedWorkText(db, input.swarmId, input.evidence, "evidence", actor);
    const reviewer = chooseWorkRecipient(workRoster(db, input.swarmId), task.owner === null ? [] : [task.owner]);
    const updated = commitTask(
      db,
      input,
      { ...task, status: "review" },
      actor,
      "review_requested",
      "",
      evidence,
      reviewer,
    );
    notifyWork(
      db,
      input.swarmId,
      reviewer,
      `Review task #${task.id}. Call swarm_tasks_get then swarm_tasks_review.`,
      input.now,
    );
    return updated;
  });
}
export function reviewTask(
  db: SwarmDb,
  input: TaskActionInput & { verdict: "accept" | "changes"; reason: string },
): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    requireStatus(task, "review");
    if (actor === task.owner)
      throw new BrokerError("validation", "Reviewer must not be the task owner. Ask an independent reviewer.");
    if (input.verdict !== "accept" && input.verdict !== "changes")
      throw new BrokerError("validation", "Review verdict must be accept or changes.");
    const reason = storedWorkText(db, input.swarmId, input.reason, "reason", actor);
    const accept = input.verdict === "accept";
    const updated = commitTask(
      db,
      input,
      {
        ...task,
        status: accept ? "accepted" : "in_progress",
        acceptedAt: accept ? input.now : null,
        acceptedBy: accept ? actor : null,
      },
      actor,
      accept ? "review_accepted" : "changes_requested",
      reason,
    );
    notifyWork(
      db,
      input.swarmId,
      task.owner,
      `Task #${task.id} review ${accept ? "accepted" : "requests changes"}. Call swarm_tasks_get.`,
      input.now,
    );
    dependencyNotifications(db, input, updated, actor, false);
    return updated;
  });
}
export function reopenTask(db: SwarmDb, input: TaskActionInput & { reason: string }): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    requireStatus(task, "accepted");
    const reason = storedWorkText(db, input.swarmId, input.reason, "reason", actor);
    const active = isActiveOwner(db, input.swarmId, task.owner);
    const updated = commitTask(
      db,
      input,
      {
        ...task,
        status: active ? "in_progress" : "new",
        owner: active ? task.owner : null,
        acceptedAt: null,
        acceptedBy: null,
      },
      actor,
      "reopened",
      reason,
    );
    dependencyNotifications(db, input, updated, actor, true);
    return updated;
  });
}

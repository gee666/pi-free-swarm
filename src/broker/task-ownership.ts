import type { TaskRecord } from "../api-work-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { workRoster } from "../store/work-roster.js";
import { BrokerError } from "./errors.js";
import { notifyWork } from "./work-notifications.js";
import { commitTask, dependencyNotifications, requireOwner } from "./task-write.js";
import { checkRevision, isActiveOwner, requireTask, type RevisionInput, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";

export type TaskActionInput = WorkInput & RevisionInput & { id: number };
export function claimTaskInTransaction(db: SwarmDb, input: WorkInput, task: TaskRecord, actor: string): TaskRecord {
  if (task.status !== "new" && (task.owner === null || isActiveOwner(db, input.swarmId, task.owner))) {
    throw new BrokerError(
      "validation",
      `Task #${task.id} is ${task.status} and owned by active ${task.owner}. Only new tasks or tasks with inactive owners can be claimed.`,
    );
  }
  return commitTask(
    db,
    input,
    { ...task, owner: actor, status: task.status === "new" ? "claimed" : task.status },
    actor,
    "claimed",
  );
}
export function claimTask(db: SwarmDb, input: TaskActionInput): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    return claimTaskInTransaction(db, input, task, actor);
  });
}
export function releaseTask(db: SwarmDb, input: TaskActionInput): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    requireOwner(task, actor);
    if (task.owner === null) throw new BrokerError("validation", `Task #${task.id} has no owner. Claim it first.`);
    const updated = commitTask(
      db,
      input,
      { ...task, status: "new", owner: null, acceptedAt: null, acceptedBy: null },
      actor,
      "released",
    );
    dependencyNotifications(db, input, updated, actor, task.status === "accepted");
    return updated;
  });
}
export function handoffTask(db: SwarmDb, input: TaskActionInput & { to: string }): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision);
    if (task.status === "review")
      throw new BrokerError("validation", "A task in review cannot be handed off. Finish the review first.");
    if (task.owner === null) throw new BrokerError("validation", "Claim an unowned task instead of handing it off.");
    if (actor !== USER_NAME && actor !== task.owner && isActiveOwner(db, input.swarmId, task.owner))
      requireOwner(task, actor);
    const recipient = workRoster(db, input.swarmId).find(
      (agent) => agent.name.toLowerCase() === input.to.toLowerCase() && agent.active,
    );
    if (!recipient) throw new BrokerError("validation", "Handoff target must be an active agent.", "to");
    if (recipient.name === task.owner)
      throw new BrokerError("validation", "Handoff target is already the owner.", "to");
    const updated = commitTask(
      db,
      input,
      { ...task, owner: recipient.name },
      actor,
      "handoff",
      `To ${recipient.name}.`,
    );
    notifyWork(db, input.swarmId, recipient.name, `Task #${task.id} handed to you. Call swarm_tasks_get.`, input.now);
    return updated;
  });
}

import type { TaskEventKind, TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { addTaskEvent, saveTask, taskDependencies, taskWaiting } from "../store/tasks.js";
import { USER_NAME } from "../constants.js";
import { BrokerError } from "./errors.js";
import { notifyWork } from "./work-notifications.js";
import type { WorkInput } from "./work-validation.js";

export function requireOwner(task: TaskRecord, actor: string): void {
  if (actor !== USER_NAME && task.owner !== actor)
    throw new BrokerError(
      "validation",
      `Only owner ${task.owner ?? "(unclaimed)"} or User can change task #${task.id}.`,
    );
}
export function requireStatus(task: TaskRecord, status: TaskRecord["status"]): void {
  if (task.status !== status)
    throw new BrokerError(
      "validation",
      `Task #${task.id} is ${task.status}; this action requires ${status}. Reread the task.`,
    );
}
export function commitTask(
  db: SwarmDb,
  input: WorkInput,
  task: TaskRecord,
  actor: string,
  kind: TaskEventKind,
  body = "",
  evidence = "",
  reviewer: string | null = null,
): TaskRecord {
  const updated = { ...task, revision: task.revision + 1, updatedAt: input.now };
  saveTask(db, updated);
  addTaskEvent(db, updated, actor, kind, input.now, body, evidence, reviewer);
  insertEvent(db, input.swarmId, "task.changed", { id: task.id }, input.now);
  return updated;
}
export function dependencyNotifications(
  db: SwarmDb,
  input: WorkInput,
  task: TaskRecord,
  actor: string,
  wasAccepted: boolean,
): void {
  if ((task.status === "accepted") === wasAccepted) return;
  for (const dependent of taskDependencies(db, task.id, true)) {
    if (task.status === "accepted" && dependent.status === "claimed" && !taskWaiting(db, dependent.id)) {
      addTaskEvent(db, dependent, actor, "dependencies_ready", input.now, `Dependency #${task.id} accepted.`);
      notifyWork(
        db,
        input.swarmId,
        dependent.owner,
        `Dependencies ready for task #${dependent.id}. Call swarm_tasks_transition with action start.`,
        input.now,
      );
    } else if (task.status !== "accepted" && dependent.status === "accepted") {
      addTaskEvent(db, dependent, actor, "dependency_reopened", input.now, `Dependency #${task.id} reopened.`);
      notifyWork(
        db,
        input.swarmId,
        dependent.owner,
        `Task #${dependent.id} has reopened dependency #${task.id}. Call swarm_tasks_get.`,
        input.now,
      );
    } else continue;
    insertEvent(db, input.swarmId, "task.changed", { id: dependent.id }, input.now);
  }
}

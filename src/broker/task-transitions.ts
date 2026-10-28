import type { TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { taskWaiting } from "../store/tasks.js";
import { BrokerError } from "./errors.js";
import type { TaskActionInput } from "./task-ownership.js";
import { commitTask, dependencyNotifications, requireOwner, requireStatus } from "./task-write.js";
import { storedWorkText } from "./work-text.js";
import { checkRevision, isActiveOwner, requireTask } from "./work-validation.js";
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

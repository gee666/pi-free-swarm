import type { CriterionLink, TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import {
  addTaskEvent,
  dependencyWouldCycle,
  insertTask,
  replaceDependencies,
  replaceTaskLinks,
  taskDependencies,
  taskLinks,
} from "../store/tasks.js";
import { BrokerError } from "./errors.js";
import { storedWorkText } from "./work-text.js";
import { checkRevision, requireCriterion, requireTask, workText, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";
import { commitTask } from "./task-write.js";
import { claimTaskInTransaction } from "./task-ownership.js";

export interface TaskFields {
  title: string;
  body: string;
  criteria: readonly CriterionLink[];
  dependsOn?: readonly number[];
}
function checkedLinks(db: SwarmDb, input: WorkInput, actor: string, links: readonly CriterionLink[]): CriterionLink[] {
  if (links.length === 0)
    throw new BrokerError("validation", "A task needs at least one criterion link with a contribution.", "criteria");
  const ids = new Set<number>();
  return links.map((link) => {
    requireCriterion(db, input.swarmId, link.criterionId);
    if (ids.has(link.criterionId))
      throw new BrokerError("validation", `Duplicate criterion #${link.criterionId}.`, "criteria");
    ids.add(link.criterionId);
    return { criterionId: link.criterionId, contribution: workText(link.contribution, "contribution", actor) };
  });
}
function checkedDependencies(db: SwarmDb, input: WorkInput, taskId: number, ids: readonly number[]): number[] {
  for (const id of ids) {
    requireTask(db, input.swarmId, id);
    if (dependencyWouldCycle(db, taskId, id))
      throw new BrokerError(
        "validation",
        `Dependency #${taskId} → #${id} creates a cycle. Remove the cycle before retrying.`,
        "depends_on",
      );
  }
  return [...new Set(ids)];
}
export function createTask(db: SwarmDb, input: WorkInput & TaskFields & { claim?: boolean }): TaskRecord {
  return writeWork(db, input, (actor) => {
    const title = workText(input.title, "title", actor, true);
    const body = storedWorkText(db, input.swarmId, input.body, "body", actor);
    const links = checkedLinks(db, input, actor, input.criteria);
    const id = insertTask(db, input.swarmId, { title, body, author: actor }, input.now);
    const dependencies = checkedDependencies(db, input, id, input.dependsOn ?? []);
    replaceTaskLinks(db, id, links);
    replaceDependencies(db, id, dependencies);
    const task = requireTask(db, input.swarmId, id);
    addTaskEvent(db, task, actor, "created", input.now);
    insertEvent(db, input.swarmId, "task.changed", { id }, input.now);
    return input.claim ? claimTaskInTransaction(db, input, task, actor) : task;
  });
}
export function editTask(
  db: SwarmDb,
  input: WorkInput & { id: number; expectedRevision: number; fields: Partial<TaskFields> },
): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    checkRevision(task.revision, input.expectedRevision, true);
    const beforeLinks = taskLinks(db, task.id);
    const beforeDeps = taskDependencies(db, task.id).map((dep) => dep.id);
    if (input.fields.criteria !== undefined) {
      const links = checkedLinks(db, input, actor, input.fields.criteria);
      replaceTaskLinks(db, task.id, links);
      for (const link of links.filter((link) => !beforeLinks.some((old) => old.criterionId === link.criterionId)))
        addTaskEvent(db, task, actor, "linked", input.now, `Criterion #${link.criterionId}.`);
      for (const link of beforeLinks.filter((link) => !links.some((next) => next.criterionId === link.criterionId)))
        addTaskEvent(db, task, actor, "unlinked", input.now, `Criterion #${link.criterionId}.`);
    }
    if (input.fields.dependsOn !== undefined) {
      const deps = checkedDependencies(db, input, task.id, input.fields.dependsOn);
      replaceDependencies(db, task.id, deps);
      for (const id of deps.filter((id) => !beforeDeps.includes(id)))
        addTaskEvent(db, task, actor, "dependency_added", input.now, `Task #${id}.`);
      for (const id of beforeDeps.filter((id) => !deps.includes(id)))
        addTaskEvent(db, task, actor, "dependency_removed", input.now, `Task #${id}.`);
    }
    return commitTask(
      db,
      input,
      {
        ...task,
        title: input.fields.title === undefined ? task.title : workText(input.fields.title, "title", actor, true),
        body:
          input.fields.body === undefined
            ? task.body
            : storedWorkText(db, input.swarmId, input.fields.body, "body", actor),
      },
      actor,
      "edited",
    );
  });
}

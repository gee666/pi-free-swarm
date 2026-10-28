import type { CriterionLink, TaskEvent, TaskEventKind, TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { PAGE_MAX_COUNT } from "../constants.js";
import { count, int, text } from "./rows.js";
import { taskEventOf, taskOf } from "./work-rows.js";

export function getTask(db: SwarmDb, swarmId: number, id: number): TaskRecord | null {
  const row = db.sql.prepare("SELECT * FROM tasks WHERE swarm_id = ? AND id = ?").get(swarmId, id);
  return row ? taskOf(row) : null;
}
export function listTasks(db: SwarmDb, swarmId: number): TaskRecord[] {
  return db.sql.prepare("SELECT * FROM tasks WHERE swarm_id = ? ORDER BY id").all(swarmId).map(taskOf);
}
export function taskLinks(db: SwarmDb, taskId: number): CriterionLink[] {
  return db.sql
    .prepare("SELECT * FROM task_criteria WHERE task_id = ? ORDER BY criterion_id")
    .all(taskId)
    .map((row) => ({ criterionId: int(row, "criterion_id"), contribution: text(row, "contribution") }));
}
export function taskDependencies(db: SwarmDb, taskId: number, reverse = false): TaskRecord[] {
  const join = reverse ? "d.task_id" : "d.depends_on";
  const filter = reverse ? "d.depends_on" : "d.task_id";
  return db.sql
    .prepare(`SELECT t.* FROM tasks t JOIN task_dependencies d ON t.id = ${join} WHERE ${filter} = ? ORDER BY t.id`)
    .all(taskId)
    .map(taskOf);
}
export function taskWaiting(db: SwarmDb, taskId: number): boolean {
  return (
    db.sql
      .prepare(
        `SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on
    WHERE d.task_id = ? AND t.status <> 'accepted' LIMIT 1`,
      )
      .get(taskId) !== undefined
  );
}
export function dependencyWouldCycle(db: SwarmDb, taskId: number, dependsOn: number): boolean {
  if (taskId === dependsOn) return true;
  return (
    db.sql
      .prepare(
        `WITH RECURSIVE ancestors(id) AS (
    SELECT depends_on FROM task_dependencies WHERE task_id = ?
    UNION SELECT d.depends_on FROM task_dependencies d JOIN ancestors a ON d.task_id = a.id
  ) SELECT 1 FROM ancestors WHERE id = ?`,
      )
      .get(dependsOn, taskId) !== undefined
  );
}
export function insertTask(
  db: SwarmDb,
  swarmId: number,
  input: { title: string; body: string; author: string },
  now: number,
): number {
  return count(
    db.sql
      .prepare(
        `INSERT INTO tasks(swarm_id, title, body, status, author, created_at, updated_at)
    VALUES (?, ?, ?, 'new', ?, ?, ?)`,
      )
      .run(swarmId, input.title, input.body, input.author, now, now).lastInsertRowid,
  );
}
export function saveTask(db: SwarmDb, task: TaskRecord): void {
  db.sql
    .prepare(
      `UPDATE tasks SET title = ?, body = ?, status = ?, owner = ?, revision = ?, content_revision = ?, updated_at = ?,
    accepted_at = ?, accepted_by = ? WHERE id = ? AND swarm_id = ?`,
    )
    .run(
      task.title,
      task.body,
      task.status,
      task.owner,
      task.revision,
      task.contentRevision,
      task.updatedAt,
      task.acceptedAt,
      task.acceptedBy,
      task.id,
      task.swarmId,
    );
}
export function replaceTaskLinks(db: SwarmDb, taskId: number, links: readonly CriterionLink[]): void {
  db.sql.prepare("DELETE FROM task_criteria WHERE task_id = ?").run(taskId);
  const insert = db.sql.prepare("INSERT INTO task_criteria(task_id, criterion_id, contribution) VALUES (?, ?, ?)");
  for (const link of links) insert.run(taskId, link.criterionId, link.contribution);
}
export function replaceDependencies(db: SwarmDb, taskId: number, ids: readonly number[]): void {
  db.sql.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
  const insert = db.sql.prepare("INSERT INTO task_dependencies(task_id, depends_on) VALUES (?, ?)");
  for (const id of ids) insert.run(taskId, id);
}
export function addTaskEvent(
  db: SwarmDb,
  task: TaskRecord,
  actor: string,
  kind: TaskEventKind,
  now: number,
  body = "",
  evidence = "",
): void {
  db.sql
    .prepare(
      `INSERT INTO task_events(swarm_id, task_id, actor, kind, body, evidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(task.swarmId, task.id, actor, kind, body, evidence, now);
}
export function taskTimeline(db: SwarmDb, taskId: number, after = 0, limit = PAGE_MAX_COUNT): TaskEvent[] {
  return db.sql
    .prepare("SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id LIMIT ?")
    .all(taskId, after, limit)
    .map(taskEventOf);
}
export function latestTaskEvidence(db: SwarmDb, taskId: number): string | null {
  const row = db.sql
    .prepare(
      "SELECT evidence FROM task_events WHERE task_id = ? AND kind = 'review_requested' ORDER BY id DESC LIMIT 1",
    )
    .get(taskId);
  return row ? text(row, "evidence") : null;
}

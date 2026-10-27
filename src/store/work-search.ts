import type { CriterionStatus, TaskStatus } from "../api-work-types.js";
import type { SQLInputValue } from "node:sqlite";
import type { SwarmDb } from "./db.js";
import { int, text, type Row } from "./rows.js";
import { WORK_STATE_CTE } from "./work-state.js";

export interface WorkCandidate {
  id: number;
  title: string;
  text: string;
  updatedAt: number;
}
export interface TaskFilters {
  status?: readonly TaskStatus[];
  owner?: string;
  author?: string;
  criterionId?: number;
  group?: string;
  runnable?: boolean;
  waiting?: boolean;
  deferred?: boolean;
  mine?: boolean;
}
export interface CriterionFilters {
  status?: readonly CriterionStatus[];
  group?: string;
  taskId?: number;
  author?: string;
  needsMyVote?: boolean;
  includeArchived?: boolean;
}
function candidateOf(row: Row): WorkCandidate {
  return {
    id: int(row, "id"),
    title: text(row, "title"),
    text: text(row, "search_text"),
    updatedAt: int(row, "updated_at"),
  };
}
export function filteredTaskCandidates(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  filters: TaskFilters = {},
): WorkCandidate[] {
  const where: string[] = [];
  const values: SQLInputValue[] = [swarmId, swarmId, swarmId];
  const add = (sql: string, value: SQLInputValue) => {
    where.push(sql);
    values.push(value);
  };
  if (filters.status) add("t.status IN (SELECT value FROM json_each(?))", JSON.stringify(filters.status));
  if (filters.owner === "unowned") where.push("t.owner IS NULL");
  else if (filters.owner !== undefined) add("t.owner = ? COLLATE NOCASE", filters.owner);
  if (filters.author !== undefined) add("t.author = ? COLLATE NOCASE", filters.author);
  if (filters.mine) add("t.owner = ? COLLATE NOCASE", actor);
  if (filters.criterionId !== undefined)
    add("EXISTS (SELECT 1 FROM task_criteria l WHERE l.task_id = t.id AND l.criterion_id = ?)", filters.criterionId);
  if (filters.group !== undefined)
    add(
      "EXISTS (SELECT 1 FROM task_criteria l JOIN criteria c ON c.id = l.criterion_id WHERE l.task_id = t.id AND c.group_name = ?)",
      filters.group,
    );
  if (filters.waiting !== undefined) add("t.waiting = ?", Number(filters.waiting));
  if (filters.runnable !== undefined) add("(t.status = 'new' AND t.waiting = 0) = ?", Number(filters.runnable));
  if (filters.deferred !== undefined) add("t.deferred = ?", Number(filters.deferred));
  return db.sql
    .prepare(
      `${WORK_STATE_CTE} SELECT t.*,
    t.body || ' ' || COALESCE((SELECT group_concat(contribution, ' ') FROM task_criteria WHERE task_id = t.id), '') AS search_text
    FROM work_tasks t ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.updated_at DESC, t.id DESC`,
    )
    .all(...values)
    .map(candidateOf);
}
export function filteredCriterionCandidates(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  filters: CriterionFilters = {},
): WorkCandidate[] {
  const where = filters.includeArchived ? [] : ["c.archived_at IS NULL"];
  const values: SQLInputValue[] = [swarmId, swarmId, swarmId];
  const add = (sql: string, value: SQLInputValue) => {
    where.push(sql);
    values.push(value);
  };
  if (filters.status) add("c.work_status IN (SELECT value FROM json_each(?))", JSON.stringify(filters.status));
  if (filters.group !== undefined) add("c.group_name = ?", filters.group);
  if (filters.taskId !== undefined)
    add("EXISTS (SELECT 1 FROM task_criteria l WHERE l.criterion_id = c.id AND l.task_id = ?)", filters.taskId);
  if (filters.author !== undefined) add("c.author = ? COLLATE NOCASE", filters.author);
  if (filters.needsMyVote) {
    where.push(`c.task_count > 0 AND NOT EXISTS (SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.voter = ? COLLATE NOCASE)
      AND (EXISTS (SELECT 1 FROM work_owners o WHERE o.criterion_id = c.id AND o.owner = ? COLLATE NOCASE AND o.active = 1)
        OR (NOT EXISTS (SELECT 1 FROM work_owners o WHERE o.criterion_id = c.id AND o.owner = ? COLLATE NOCASE)
          AND NOT EXISTS (SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND NOT EXISTS (
            SELECT 1 FROM work_owners o WHERE o.criterion_id = c.id AND o.owner = v.voter))))`);
    values.push(actor, actor, actor);
  }
  return db.sql
    .prepare(
      `${WORK_STATE_CTE} SELECT c.*, c.group_name || ' ' || c.body || ' ' || c.verification AS search_text
    FROM work_criteria c ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.updated_at DESC, c.id DESC`,
    )
    .all(...values)
    .map(candidateOf);
}

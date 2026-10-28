import type { CriterionStatus } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { int, text, type Row } from "./rows.js";
import { enumText } from "./work-rows.js";
import { WORK_AGENT_ACTIVE_SQL } from "./work-roster.js";

// Shared by filtering and domain reads so status and search cannot disagree.
export const WORK_STATE_CTE = `WITH
  work_scope AS MATERIALIZED (SELECT * FROM criteria WHERE swarm_id = ?),
  work_link_rows AS MATERIALIZED (
    SELECT l.criterion_id, t.* FROM task_criteria l JOIN tasks t ON t.id = l.task_id
      JOIN work_scope c ON c.id = l.criterion_id ORDER BY t.id
  ),
  work_link_totals AS (
    SELECT criterion_id, group_concat(id || ':' || content_revision, ',') AS links_signature,
      count(*) AS task_count, sum(status <> 'accepted') AS unaccepted_count,
      sum(owner IS NULL) AS unowned_count
    FROM work_link_rows GROUP BY criterion_id
  ),
  work_links AS MATERIALIZED (
    SELECT c.id AS criterion_id, COALESCE(l.links_signature, '') AS links_signature,
      COALESCE(l.task_count, 0) AS task_count, COALESCE(l.unaccepted_count, 0) AS unaccepted_count,
      COALESCE(l.unowned_count, 0) AS unowned_count
    FROM work_scope c LEFT JOIN work_link_totals l ON l.criterion_id = c.id
  ),
  work_votes AS MATERIALIZED (
    SELECT v.* FROM criterion_votes v JOIN work_scope c ON c.id = v.criterion_id
      JOIN work_links l ON l.criterion_id = c.id LEFT JOIN criterion_blockers b ON b.criterion_id = c.id
    WHERE v.criterion_revision = c.revision AND v.links_signature = l.links_signature
      AND (v.verdict <> 'blocked' OR (v.blocker_revision = b.revision AND (b.rejected_revision IS NULL OR b.rejected_revision <> b.revision)))
  ),
  work_owners AS MATERIALIZED (
    SELECT DISTINCT l.criterion_id, t.owner,
      CASE WHEN p.kind = 'user' OR (p.kind = 'agent' AND (${WORK_AGENT_ACTIVE_SQL}))
        THEN 1 ELSE 0 END AS active
    FROM task_criteria l JOIN tasks t ON t.id = l.task_id
      LEFT JOIN participants p ON p.swarm_id = t.swarm_id AND p.name = t.owner
    WHERE t.owner IS NOT NULL AND t.swarm_id = ?
  ),
  work_owner_totals AS (
    SELECT o.criterion_id, sum(o.active = 0) AS offline_count,
      sum(o.active = 1 AND (v.verdict IS NULL OR v.verdict <> 'covered')) AS missing_covered,
      sum(o.active = 1 AND (v.verdict IS NULL OR v.verdict <> 'blocked')) AS missing_blocked
    FROM work_owners o LEFT JOIN work_votes v ON v.criterion_id = o.criterion_id AND v.voter = o.owner
    GROUP BY o.criterion_id
  ),
  work_vote_totals AS (
    SELECT v.criterion_id,
      max(v.verdict = 'covered' AND o.owner IS NULL) AS independent_covered,
      max(v.verdict = 'blocked' AND o.owner IS NULL) AS independent_blocked,
      max(v.verdict <> 'covered') AS negative_vote
    FROM work_votes v LEFT JOIN work_owners o ON o.criterion_id = v.criterion_id AND o.owner = v.voter
    GROUP BY v.criterion_id
  ),
  work_agreement AS (
    SELECT l.*, COALESCE(o.offline_count, 0) AS offline_count,
      COALESCE(o.missing_covered, 0) AS missing_covered, COALESCE(o.missing_blocked, 0) AS missing_blocked,
      COALESCE(v.independent_covered, 0) AS independent_covered,
      COALESCE(v.independent_blocked, 0) AS independent_blocked,
      COALESCE(v.negative_vote, 0) AS negative_vote, b.revision AS blocker_revision
    FROM work_links l LEFT JOIN work_owner_totals o ON o.criterion_id = l.criterion_id
      LEFT JOIN work_vote_totals v ON v.criterion_id = l.criterion_id
      LEFT JOIN criterion_blockers b ON b.criterion_id = l.criterion_id
  ),
  work_criteria AS (
    SELECT c.*, a.links_signature, a.task_count, a.unaccepted_count, a.unowned_count, a.offline_count,
      a.missing_covered, a.missing_blocked, a.independent_covered, a.independent_blocked,
      CASE WHEN a.task_count = 0 THEN 'unlinked'
        WHEN a.offline_count = 0 AND a.blocker_revision IS NOT NULL AND a.missing_blocked = 0 AND a.independent_blocked = 1 THEN 'blocked'
        WHEN a.offline_count = 0 AND a.unaccepted_count = 0 AND a.missing_covered = 0
          AND a.independent_covered = 1 AND a.negative_vote = 0 THEN 'satisfied'
        ELSE 'incomplete' END AS work_status
    FROM work_scope c JOIN work_agreement a ON a.criterion_id = c.id
  ),
  work_tasks AS (
    SELECT t.*,
      EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on
        WHERE d.task_id = t.id AND dep.status <> 'accepted') AS waiting,
      t.status <> 'accepted' AND EXISTS (SELECT 1 FROM task_criteria l WHERE l.task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM task_criteria l JOIN work_criteria c ON c.id = l.criterion_id
          WHERE l.task_id = t.id AND c.work_status <> 'blocked') AS deferred
    FROM tasks t WHERE t.swarm_id = ?
  )`;

export interface CriterionState {
  id: number;
  status: CriterionStatus;
  linksSignature: string;
  taskCount: number;
  unacceptedCount: number;
  unownedCount: number;
  offlineCount: number;
}
function criterionStateOf(row: Row): CriterionState {
  return {
    id: int(row, "id"),
    status: enumText(row, "work_status", ["unlinked", "incomplete", "satisfied", "blocked"]),
    linksSignature: text(row, "links_signature"),
    taskCount: int(row, "task_count"),
    unacceptedCount: int(row, "unaccepted_count"),
    unownedCount: int(row, "unowned_count"),
    offlineCount: int(row, "offline_count"),
  };
}
export function criterionStates(db: SwarmDb, swarmId: number, includeArchived = false): CriterionState[] {
  return db.sql
    .prepare(
      `${WORK_STATE_CTE} SELECT * FROM work_criteria ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY id`,
    )
    .all(swarmId, swarmId, swarmId)
    .map(criterionStateOf);
}
export function taskStates(
  db: SwarmDb,
  swarmId: number,
): { id: number; waiting: boolean; runnable: boolean; deferred: boolean }[] {
  return db.sql
    .prepare(`${WORK_STATE_CTE} SELECT id, status, waiting, deferred FROM work_tasks ORDER BY id`)
    .all(swarmId, swarmId, swarmId)
    .map((row) => ({
      id: int(row, "id"),
      waiting: int(row, "waiting") === 1,
      runnable: text(row, "status") === "new" && int(row, "waiting") === 0,
      deferred: int(row, "deferred") === 1,
    }));
}

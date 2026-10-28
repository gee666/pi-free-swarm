import type { CriterionStatus } from "../../src/api-work-types.js";
import type { SwarmDb } from "../../src/store/db.js";
import { int, text, type Row } from "../../src/store/rows.js";
import { enumText } from "../../src/store/work-rows.js";
import { WORK_AGENT_ACTIVE_SQL } from "../../src/store/work-roster.js";

// Frozen pre-optimization SQL is an independent oracle for the grouped queries.
const WORK_STATE_CTE = `WITH
  work_links AS (
    SELECT c.id AS criterion_id,
      COALESCE((SELECT group_concat(signature, ',') FROM (
        SELECT t.id || ':' || t.content_revision AS signature FROM task_criteria l JOIN tasks t ON t.id = l.task_id
        WHERE l.criterion_id = c.id ORDER BY t.id
      )), '') AS links_signature,
      (SELECT count(*) FROM task_criteria l WHERE l.criterion_id = c.id) AS task_count,
      (SELECT count(*) FROM task_criteria l JOIN tasks t ON t.id = l.task_id
        WHERE l.criterion_id = c.id AND t.status <> 'accepted') AS unaccepted_count,
      (SELECT count(*) FROM task_criteria l JOIN tasks t ON t.id = l.task_id
        WHERE l.criterion_id = c.id AND t.owner IS NULL) AS unowned_count
    FROM criteria c WHERE c.swarm_id = ?
  ),
  work_votes AS (
    SELECT v.* FROM criterion_votes v JOIN criteria c ON c.id = v.criterion_id
      JOIN work_links l ON l.criterion_id = c.id LEFT JOIN criterion_blockers b ON b.criterion_id = c.id
    WHERE v.criterion_revision = c.revision AND v.links_signature = l.links_signature
      AND (v.verdict <> 'blocked' OR (v.blocker_revision = b.revision AND (b.rejected_revision IS NULL OR b.rejected_revision <> b.revision)))
  ),
  work_owners AS (
    SELECT DISTINCT l.criterion_id, t.owner,
      CASE WHEN p.kind = 'user' OR (p.kind = 'agent' AND (${WORK_AGENT_ACTIVE_SQL}))
        THEN 1 ELSE 0 END AS active
    FROM task_criteria l JOIN tasks t ON t.id = l.task_id
      LEFT JOIN participants p ON p.swarm_id = t.swarm_id AND p.name = t.owner
    WHERE t.owner IS NOT NULL AND t.swarm_id = ?
  ),
  work_agreement AS (
    SELECT l.*,
      (SELECT count(*) FROM work_owners o WHERE o.criterion_id = c.id AND o.active = 0) AS offline_count,
      (SELECT count(*) FROM work_owners o WHERE o.criterion_id = c.id AND o.active = 1 AND NOT EXISTS (
        SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.voter = o.owner AND v.verdict = 'covered'
      )) AS missing_covered,
      (SELECT count(*) FROM work_owners o WHERE o.criterion_id = c.id AND o.active = 1 AND NOT EXISTS (
        SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.voter = o.owner AND v.verdict = 'blocked'
      )) AS missing_blocked,
      EXISTS (SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.verdict = 'covered' AND NOT EXISTS (
        SELECT 1 FROM work_owners o WHERE o.criterion_id = c.id AND o.owner = v.voter
      )) AS independent_covered,
      EXISTS (SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.verdict = 'blocked' AND NOT EXISTS (
        SELECT 1 FROM work_owners o WHERE o.criterion_id = c.id AND o.owner = v.voter
      )) AS independent_blocked,
      EXISTS (SELECT 1 FROM work_votes v WHERE v.criterion_id = c.id AND v.verdict <> 'covered') AS negative_vote,
      b.revision AS blocker_revision
    FROM work_links l JOIN criteria c ON c.id = l.criterion_id
      LEFT JOIN criterion_blockers b ON b.criterion_id = c.id
  ),
  work_criteria AS (
    SELECT c.*, a.links_signature, a.task_count, a.unaccepted_count, a.unowned_count, a.offline_count,
      a.missing_covered, a.missing_blocked, a.independent_covered, a.independent_blocked,
      CASE WHEN a.task_count = 0 THEN 'unlinked'
        WHEN a.offline_count = 0 AND a.blocker_revision IS NOT NULL AND a.missing_blocked = 0 AND a.independent_blocked = 1 THEN 'blocked'
        WHEN a.offline_count = 0 AND a.unaccepted_count = 0 AND a.missing_covered = 0
          AND a.independent_covered = 1 AND a.negative_vote = 0 THEN 'satisfied'
        ELSE 'incomplete' END AS work_status
    FROM criteria c JOIN work_agreement a ON a.criterion_id = c.id
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

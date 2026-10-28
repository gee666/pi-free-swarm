import type { SwarmDb } from "./db.js";
import type { WorkActivityRow } from "../api-types.js";
import { int, intOrNull, text } from "./rows.js";
import { enumText } from "./work-rows.js";
import {
  WORK_VELOCITY_SHORT_MS,
  WORK_VELOCITY_LONG_MS,
  WORK_ETA_MIN_AGE_MS,
  WORK_ETA_MIN_ACCEPTED,
} from "../constants.js";

export function workVelocity(db: SwarmDb, swarmId: number, now: number, remaining: number) {
  const row = db.sql
    .prepare(
      `SELECT started_at,
    (SELECT count(*) FROM tasks WHERE swarm_id = ? AND status = 'accepted' AND accepted_at BETWEEN ? AND ?) AS short_count,
    (SELECT count(*) FROM tasks WHERE swarm_id = ? AND status = 'accepted' AND accepted_at BETWEEN ? AND ?) AS long_count
    FROM swarms WHERE id = ?`,
    )
    .get(swarmId, now - WORK_VELOCITY_SHORT_MS, now, swarmId, now - WORK_VELOCITY_LONG_MS, now, swarmId);
  const shortCount = row ? int(row, "short_count") : 0;
  const longCount = row ? int(row, "long_count") : 0;
  const startedAt = row ? intOrNull(row, "started_at") : null;
  return {
    accepted15Minutes: shortCount,
    accepted60Minutes: longCount,
    etaMs:
      startedAt !== null && now - startedAt >= WORK_ETA_MIN_AGE_MS && longCount >= WORK_ETA_MIN_ACCEPTED
        ? (remaining / longCount) * WORK_VELOCITY_LONG_MS
        : null,
  };
}
export function recentWorkActivity(db: SwarmDb, swarmId: number, limit: number): WorkActivityRow[] {
  return db.sql
    .prepare(
      `SELECT * FROM (
    SELECT 'task-event:' || e.id AS id, e.actor, e.kind, 'task' AS target_kind,
      e.task_id AS target_id, t.title, e.created_at
    FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE e.swarm_id = ?
    UNION ALL
    SELECT 'criterion-event:' || e.id, e.actor, e.kind, 'criterion', e.criterion_id, c.title, e.created_at
    FROM criterion_events e JOIN criteria c ON c.id = e.criterion_id WHERE e.swarm_id = ?
  ) ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(swarmId, swarmId, limit)
    .map((row) => ({
      id: text(row, "id"),
      actor: text(row, "actor"),
      kind: text(row, "kind"),
      targetKind: enumText(row, "target_kind", ["task", "criterion"]),
      targetId: int(row, "target_id"),
      title: text(row, "title"),
      createdAt: int(row, "created_at"),
    }));
}

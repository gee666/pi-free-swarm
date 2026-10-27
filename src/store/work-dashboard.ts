import type { SwarmDb } from "./db.js";
import { int, intOrNull } from "./rows.js";
import { taskOf, taskEventOf } from "./work-rows.js";
import {
  WORK_VELOCITY_SHORT_MS,
  WORK_VELOCITY_LONG_MS,
  WORK_ETA_MIN_AGE_MS,
  WORK_ETA_MIN_ACCEPTED,
} from "../constants.js";

export function assignedReviews(db: SwarmDb, swarmId: number, actor: string) {
  return db.sql
    .prepare(
      `SELECT t.* FROM tasks t WHERE t.swarm_id = ? AND t.status = 'review'
    AND (SELECT json_extract(e.body, '$.reviewer') FROM task_events e
      WHERE e.task_id = t.id AND e.kind = 'review_requested' ORDER BY e.id DESC LIMIT 1) = ? ORDER BY t.id`,
    )
    .all(swarmId, actor)
    .map(taskOf);
}
export function workVelocity(db: SwarmDb, swarmId: number, now: number, remaining: number) {
  const row = db.sql
    .prepare(
      `SELECT started_at,
    (SELECT count(*) FROM tasks WHERE swarm_id = ? AND status = 'accepted' AND accepted_at >= ?) AS short_count,
    (SELECT count(*) FROM tasks WHERE swarm_id = ? AND status = 'accepted' AND accepted_at >= ?) AS long_count
    FROM swarms WHERE id = ?`,
    )
    .get(swarmId, now - WORK_VELOCITY_SHORT_MS, swarmId, now - WORK_VELOCITY_LONG_MS, swarmId);
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
export function recentWorkActivity(db: SwarmDb, swarmId: number, limit: number) {
  return db.sql
    .prepare("SELECT * FROM task_events WHERE swarm_id = ? ORDER BY id DESC LIMIT ?")
    .all(swarmId, limit)
    .map(taskEventOf);
}

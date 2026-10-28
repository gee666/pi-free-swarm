import type { SwarmDb } from "./db.js";
import type { WorkActivityRow } from "../api-types.js";
import { int, intOrNull, real, text } from "./rows.js";
import { enumText } from "./work-rows.js";
import {
  WORK_VELOCITY_SHORT_MS,
  WORK_VELOCITY_LONG_MS,
  WORK_ETA_MIN_AGE_MS,
  WORK_ETA_MIN_ACCEPTED,
  WORK_THROUGHPUT_HOUR_MS,
  WORK_THROUGHPUT_WHOLE_HOURS,
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
export function workThroughput(db: SwarmDb, swarmId: number, now: number) {
  const currentHour = Math.floor(now / WORK_THROUGHPUT_HOUR_MS) * WORK_THROUGHPUT_HOUR_MS;
  const start = currentHour - WORK_THROUGHPUT_WHOLE_HOURS * WORK_THROUGHPUT_HOUR_MS;
  const counts = new Map(
    db.sql
      .prepare(
        `SELECT CAST(created_at / ? AS INTEGER) * ? AS hour_start, count(*) AS accepted
    FROM task_events WHERE swarm_id = ? AND kind = 'review_accepted' AND created_at BETWEEN ? AND ?
    GROUP BY hour_start`,
      )
      .all(WORK_THROUGHPUT_HOUR_MS, WORK_THROUGHPUT_HOUR_MS, swarmId, start, now)
      .map((row) => [int(row, "hour_start"), int(row, "accepted")]),
  );
  return Array.from({ length: WORK_THROUGHPUT_WHOLE_HOURS + 1 }, (_, index) => {
    const hourStart = start + index * WORK_THROUGHPUT_HOUR_MS;
    return { hourStart, accepted: counts.get(hourStart) ?? 0 };
  });
}
export function runCostUsd(db: SwarmDb, swarmId: number, run: number): number {
  const row = db.sql
    .prepare("SELECT COALESCE(sum(cost), 0) AS cost FROM usage WHERE swarm_id = ? AND run = ?")
    .get(swarmId, run);
  return row === undefined ? 0 : real(row, "cost");
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

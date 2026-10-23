// The change outbox is written with state changes and tailed by the server host.
import type { SwarmEvent, SwarmEventPayloads, SwarmEventType } from "../api-types.js";
import type { SwarmDb, WriteTransaction } from "./db.js";
import { count, int, text } from "./rows.js";

const EVENT_TYPES: ReadonlySet<string> = new Set<SwarmEventType>([
  "acceptance.updated",
  "post.created",
  "comment.created",
  "user.post.updated",
  "message.created",
  "message.status",
  "participant.updated",
  "usage.updated",
  "swarm.updated",
  "session.appended",
]);

function isEventType(value: string): value is SwarmEventType {
  return EVENT_TYPES.has(value);
}

export function insertEvent<T extends SwarmEventType>(
  db: WriteTransaction,
  swarmId: number,
  type: T,
  payload: SwarmEventPayloads[T],
  now: number,
): number {
  const result = db.sql
    .prepare("INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(swarmId, type, JSON.stringify(payload), now);
  return count(result.lastInsertRowid);
}

export interface EventPage {
  events: SwarmEvent[];
  /** Raw scan progress, including unsupported event types. */
  scannedThrough: number;
  hasMore: boolean;
}

/** Malformed supported payloads fail the scan rather than silently losing a known event. */
export function scanEventsAfter(db: SwarmDb, afterId: number, limit: number, throughId = latestEventId(db)): EventPage {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Event scan limit must be a positive integer");
  const rows = db.sql
    .prepare("SELECT * FROM events WHERE id > ? AND id <= ? ORDER BY id LIMIT ?")
    .all(afterId, throughId, limit + 1);
  const hasMore = rows.length > limit;
  const scanned = rows.slice(0, limit);
  const events: SwarmEvent[] = [];
  for (const row of scanned) {
    const type = text(row, "type");
    if (!isEventType(type)) continue;
    try {
      const payload = JSON.parse(text(row, "payload"));
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("payload must be an object");
      }
      events.push({
        id: int(row, "id"),
        swarmId: int(row, "swarm_id"),
        type,
        payload,
        createdAt: int(row, "created_at"),
      });
    } catch (error) {
      throw new Error(`Invalid payload for event #${int(row, "id")} (${type})`, { cause: error });
    }
  }
  return {
    events,
    scannedThrough: hasMore ? int(scanned[scanned.length - 1], "id") : Math.max(afterId, throughId),
    hasMore,
  };
}

/** Compatibility reader. Tailing callers must use raw scan progress instead of decoded length. */
export function listEventsAfter(db: SwarmDb, afterId: number, limit: number): SwarmEvent[] {
  return scanEventsAfter(db, afterId, limit).events;
}

export function latestEventId(db: SwarmDb): number {
  const row = db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get();
  const sequence = db.sql.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get();
  return Math.max(row === undefined ? 0 : int(row, "id"), sequence === undefined ? 0 : int(sequence, "seq"));
}

/** Only recorded deletions establish gaps. Globally nonconsecutive IDs do not. */
export function eventRetentionGap(db: SwarmDb, swarmId: number | null, afterId: number): number | null {
  const row = db.sql.prepare("SELECT pruned_through FROM event_retention WHERE swarm_id = ?").get(swarmId ?? 0);
  const through = row === undefined ? 0 : int(row, "pruned_through");
  return through > afterId ? through : null;
}

/** The deletion watermark and pruning commit together, including nested writes. */
export function pruneEvents(db: SwarmDb, olderThan: number): number {
  return db.write((tx) => {
    const mark = tx.sql.prepare(
      "INSERT INTO event_retention (swarm_id, pruned_through) VALUES (?, ?) " +
        "ON CONFLICT(swarm_id) DO UPDATE SET pruned_through = MAX(pruned_through, excluded.pruned_through)",
    );
    const rows = tx.sql
      .prepare("SELECT swarm_id, MAX(id) AS id FROM events WHERE created_at < ? GROUP BY swarm_id")
      .all(olderThan);
    for (const row of rows) mark.run(int(row, "swarm_id"), int(row, "id"));
    const picker = tx.sql
      .prepare("SELECT MAX(id) AS id FROM events WHERE created_at < ? AND type = 'swarm.updated'")
      .get(olderThan);
    if (picker?.id !== null && picker?.id !== undefined) mark.run(0, int(picker, "id"));
    return count(tx.sql.prepare("DELETE FROM events WHERE created_at < ?").run(olderThan).changes);
  });
}

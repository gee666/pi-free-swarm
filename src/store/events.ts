// The change outbox. Written by broker/* in the same transaction as each change; tailed by the server host.
import type { SwarmEvent, SwarmEventPayloads, SwarmEventType } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { count, int, text } from "./rows.js";

const EVENT_TYPES: ReadonlySet<string> = new Set<SwarmEventType>([
  "post.created",
  "comment.created",
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
  db: SwarmDb,
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

/** In id order. Rows of types this version does not know (written by a newer one) are skipped. */
export function listEventsAfter(db: SwarmDb, afterId: number, limit: number): SwarmEvent[] {
  const rows = db.sql.prepare("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?").all(afterId, limit);
  const events: SwarmEvent[] = [];
  for (const row of rows) {
    const type = text(row, "type");
    if (!isEventType(type)) continue;
    events.push({
      id: int(row, "id"),
      swarmId: int(row, "swarm_id"),
      type,
      payload: JSON.parse(text(row, "payload")),
      createdAt: int(row, "created_at"),
    });
  }
  return events;
}

export function latestEventId(db: SwarmDb): number {
  const row = db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get();
  return row === undefined ? 0 : int(row, "id");
}

/** Deletes rows created before `olderThan`; returns how many. */
export function pruneEvents(db: SwarmDb, olderThan: number): number {
  return count(db.sql.prepare("DELETE FROM events WHERE created_at < ?").run(olderThan).changes);
}

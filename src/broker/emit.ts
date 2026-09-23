// Outbox rows whose payload is a fresh snapshot of a record. Called inside the write that changed it.
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { unreadCounts } from "../store/message-queries.js";
import { int, recipientOf } from "../store/rows.js";
import { getParticipant, getSwarm } from "../store/swarm-queries.js";

/** No-op for Main and System, which have no participant view. */
export function emitParticipantUpdated(db: SwarmDb, swarmId: number, name: string, now: number): void {
  const participant = getParticipant(db, swarmId, name);
  if (participant !== null) insertEvent(db, swarmId, "participant.updated", { participant }, now);
}

export function emitSwarmUpdated(db: SwarmDb, swarmId: number, now: number): void {
  const swarm = getSwarm(db, swarmId, now);
  if (swarm !== null) insertEvent(db, swarmId, "swarm.updated", { swarm }, now);
}

export function emitRecipientStatus(db: SwarmDb, swarmId: number, messageId: number, name: string, now: number): void {
  const row = db.sql
    .prepare(
      `SELECT r.*, m.thread_id FROM message_recipients r JOIN messages m ON m.id = r.message_id
       WHERE r.message_id = ? AND r.name = ?`,
    )
    .get(messageId, name);
  if (row === undefined) return;
  const recipient = recipientOf(row);
  insertEvent(
    db,
    swarmId,
    "message.status",
    { messageId, threadId: int(row, "thread_id"), recipient, unread: unreadCounts(db, swarmId, [recipient.name]) },
    now,
  );
}

// Runner side of recipient status. `WHERE` guards keep `pending → delivered → read` monotonic, so a late
// or duplicate signal never moves a status back and `undeliverable` stays final.
import type { SwarmDb } from "../store/db.js";
import { count } from "../store/rows.js";
import { emitRecipientStatus } from "./emit.js";
import { requireParticipant } from "./validate.js";

function applyToEach(
  db: SwarmDb,
  swarmId: number,
  name: string,
  messageIds: readonly number[],
  now: number,
  sql: string,
): number {
  return db.write(() => {
    const recipient = requireParticipant(db, swarmId, name).name;
    const update = db.sql.prepare(sql);
    let changed = 0;
    for (const messageId of new Set(messageIds)) {
      if (count(update.run(now, messageId, swarmId, recipient).changes) === 0) continue;
      changed++;
      emitRecipientStatus(db, swarmId, messageId, recipient, now);
    }
    return changed;
  });
}

/** pi accepted the prompt carrying these messages into the agent's queue. */
export function markDelivered(
  db: SwarmDb,
  swarmId: number,
  name: string,
  messageIds: readonly number[],
  now: number,
): number {
  return applyToEach(
    db,
    swarmId,
    name,
    messageIds,
    now,
    `UPDATE message_recipients SET status = 'delivered', delivered_at = ?
     WHERE message_id = ? AND swarm_id = ? AND name = ? AND status = 'pending'`,
  );
}

/** The messages entered the agent's context. A read seen before the delivery ack also fills `delivered_at`. */
export function markRead(
  db: SwarmDb,
  swarmId: number,
  name: string,
  messageIds: readonly number[],
  now: number,
): number {
  return applyToEach(
    db,
    swarmId,
    name,
    messageIds,
    now,
    `UPDATE message_recipients SET status = 'read', read_at = ?1, delivered_at = COALESCE(delivered_at, ?1)
     WHERE message_id = ?2 AND swarm_id = ?3 AND name = ?4 AND status IN ('pending', 'delivered')`,
  );
}

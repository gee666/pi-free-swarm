// Inserting threads and messages, and the §7.4 race rule. Shared by messages.ts and the run cleanup.
import type { MessageView, RecipientStatus } from "../api-types.js";
import { SYSTEM_NAME, UNDELIVERABLE_REPLY_TEXT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { getMessages, unreadCounts } from "../store/message-queries.js";
import { count } from "../store/rows.js";
import { getSwarm, type ParticipantRef } from "../store/swarm-queries.js";

export interface RecipientInput {
  name: string;
  status: RecipientStatus;
}

/** `members[0]` is the creator. Names must be canonical and distinct. */
export function createThread(db: SwarmDb, swarmId: number, members: readonly string[], now: number): number {
  const threadId = count(
    db.sql
      .prepare("INSERT INTO threads (swarm_id, created_by, created_at) VALUES (?, ?, ?)")
      .run(swarmId, members[0], now).lastInsertRowid,
  );
  const insert = db.sql.prepare("INSERT INTO thread_members (thread_id, name, position) VALUES (?, ?, ?)");
  members.forEach((name, position) => insert.run(threadId, name, position));
  return threadId;
}

/** Stores one message with its recipient rows; emits `message.created`. */
export function insertMessage(
  db: SwarmDb,
  input: {
    swarmId: number;
    threadId: number;
    sender: string;
    text: string;
    recipients: readonly RecipientInput[];
    now: number;
  },
): MessageView {
  const { swarmId, threadId, now } = input;
  const messageId = count(
    db.sql
      .prepare("INSERT INTO messages (swarm_id, thread_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(swarmId, threadId, input.sender, input.text, now).lastInsertRowid,
  );
  const insert = db.sql.prepare(
    `INSERT INTO message_recipients (message_id, swarm_id, name, position, status, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  input.recipients.forEach((recipient, position) =>
    insert.run(
      messageId,
      swarmId,
      recipient.name,
      position,
      recipient.status,
      recipient.status === "delivered" ? now : null,
    ),
  );
  const [message] = getMessages(db, [messageId]);
  const names = input.recipients.map((recipient) => recipient.name);
  insertEvent(db, swarmId, "message.created", { message, unread: unreadCounts(db, swarmId, names) }, now);
  return message;
}

/** The automatic notice that a message will never be delivered; only agents and User can receive it. */
export function addUndeliverableReply(
  db: SwarmDb,
  swarmId: number,
  threadId: number,
  to: ParticipantRef,
  now: number,
): void {
  if (to.kind !== "agent" && to.kind !== "user") return;
  insertMessage(db, {
    swarmId,
    threadId,
    sender: SYSTEM_NAME,
    text: UNDELIVERABLE_REPLY_TEXT,
    recipients: [{ name: to.name, status: to.kind === "user" ? "delivered" : "undeliverable" }],
    now,
  });
}

/**
 * Sends into an existing thread. Liveness is decided inside the caller's transaction: agent recipients
 * are `pending` while the swarm runs, else `undeliverable` (final) with a System notice to the sender.
 * User recipients are `delivered` as soon as the message is stored.
 */
export function sendToThread(
  db: SwarmDb,
  input: {
    swarmId: number;
    threadId: number;
    sender: ParticipantRef;
    recipients: readonly ParticipantRef[];
    text: string;
    now: number;
  },
): { message: MessageView; pending: boolean } {
  const { swarmId, threadId, now } = input;
  const live = getSwarm(db, swarmId, now)?.acceptsMessages === true;
  const recipients = input.recipients.map((recipient): RecipientInput => ({
    name: recipient.name,
    status: recipient.kind === "user" ? "delivered" : live ? "pending" : "undeliverable",
  }));
  const message = insertMessage(db, {
    swarmId,
    threadId,
    sender: input.sender.name,
    text: input.text,
    recipients,
    now,
  });
  const hasAgent = input.recipients.some((recipient) => recipient.kind === "agent");
  if (!live && hasAgent) addUndeliverableReply(db, swarmId, threadId, input.sender, now);
  return { message, pending: live && hasAgent };
}

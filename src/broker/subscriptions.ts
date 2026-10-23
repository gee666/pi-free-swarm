import type { CommentView } from "../api-types.js";
import { SYSTEM_NAME, WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { int, text as str } from "../store/rows.js";
import { findParticipant, type ParticipantRef } from "../store/swarm-queries.js";
import { getPost } from "../store/wall-queries.js";
import { markCommentsCovered } from "../store/wall-coverage.js";
import { emitRecipientStatus } from "./emit.js";
import { BrokerError } from "./errors.js";
import { createThread, insertMessage } from "./message-insert.js";
import { actAs, requireSwarm } from "./validate.js";
import { hasUserAttachment } from "./user-attachment.js";

/** Automatic participation never reverses an explicit opt-out. Caller owns the write transaction. */
export function autoSubscribe(db: SwarmDb, swarmId: number, postId: number, name: string): void {
  db.sql
    .prepare(
      `INSERT OR IGNORE INTO post_subscriptions (swarm_id, post_id, name, subscribed)
    VALUES (?, ?, ?, 1)`,
    )
    .run(swarmId, postId, name);
}

export function setPostSubscription(
  db: SwarmDb,
  swarmId: number,
  name: string,
  postId: number,
  subscribed: boolean,
  now: number,
): void {
  db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, name, now);
    if (!Number.isSafeInteger(postId) || postId < 1)
      throw new BrokerError("validation", "post_id must be a positive integer.", "post_id");
    if (getPost(db, swarmId, postId) === null) throw new BrokerError("not_found", `Post #${postId} not found.`);
    db.sql
      .prepare(
        `INSERT INTO post_subscriptions (swarm_id, post_id, name, subscribed) VALUES (?, ?, ?, ?)
      ON CONFLICT (post_id, name) DO UPDATE SET subscribed = excluded.subscribed`,
      )
      .run(swarmId, postId, participant.name, subscribed ? 1 : 0);
    if (subscribed) return;
    const pending = db.sql
      .prepare(
        `SELECT r.message_id FROM message_recipients r
      JOIN comment_notifications n ON n.message_id = r.message_id
      WHERE r.swarm_id = ? AND r.name = ? AND r.status = 'pending' AND n.post_id = ?`,
      )
      .all(swarmId, participant.name, postId);
    for (const row of pending) {
      const messageId = int(row, "message_id");
      db.sql
        .prepare(
          `UPDATE message_recipients SET status = 'undeliverable' WHERE message_id = ? AND name = ? AND status = 'pending'`,
        )
        .run(messageId, participant.name);
      emitRecipientStatus(db, swarmId, messageId, participant.name, now);
    }
  });
}

/** One durable message per comment, delivered through the ordinary native steering path. */
export function notifyComment(db: SwarmDb, comment: CommentView, now: number): void {
  const { swarmId, postId, author } = comment;
  const recipients = db.sql
    .prepare(`SELECT name FROM post_subscriptions WHERE swarm_id = ? AND post_id = ? AND subscribed = 1 AND name != ?`)
    .all(swarmId, postId, author)
    .map((row) => findParticipant(db, swarmId, str(row, "name")))
    .filter(
      (person): person is ParticipantRef => person !== null && (person.kind === "agent" || person.kind === "user"),
    );
  if (recipients.length === 0) return;
  const threadId = createThread(db, swarmId, [SYSTEM_NAME, ...recipients.map((person) => person.name)], now);
  insertMessage(db, {
    swarmId,
    threadId,
    sender: SYSTEM_NAME,
    text: comment.text,
    commentSource: { postId, commentId: comment.id },
    recipients: recipients.map((person) => ({
      name: person.name,
      status: person.kind === "user" ? "delivered" : "pending",
    })),
    now,
  });
}

/** Called only when the current worker generation observed the complete durable message. */
export function coverCommentNotifications(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  messageIds: readonly number[],
  fullyReturned = false,
): void {
  db.write(() => {
    const query = db.sql.prepare(`SELECT n.comment_id FROM comment_notifications n
      JOIN message_recipients r ON r.message_id = n.message_id
      WHERE r.swarm_id = ? AND r.name = ? AND r.message_id = ? AND (? = 1 OR r.status = 'read')`);
    const comments = messageIds
      .flatMap((id) => query.all(swarmId, reader, id, fullyReturned ? 1 : 0).map((row) => int(row, "comment_id")))
      .filter((id) => reader !== WATCHER_NAME || !hasUserAttachment(db, swarmId, "comment", id));
    markCommentsCovered(db, swarmId, reader, comments);
  });
}

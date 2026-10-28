import type { CommentView } from "../api-types.js";
import { COMMENT_NOTICE_CHARS, COMMENT_NOTICE_WINDOW_MS } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { count, int, text as str } from "../store/rows.js";
import { findParticipant, type ParticipantRef } from "../store/swarm-queries.js";
import { postExists } from "../store/wall-queries.js";
import { emitRecipientStatus } from "./emit.js";
import { BrokerError } from "./errors.js";
import { insertSystemNotice } from "./message-insert.js";
import { retiringWorkers } from "../store/retirement.js";
import { actAs, requireSwarm } from "./validate.js";
import { recordUserCommentAttention } from "../store/user-comment-attention.js";

/** Automatic participation never reverses an explicit opt-out. Caller owns the write transaction. */
export function autoSubscribe(db: SwarmDb, swarmId: number, postId: number, name: string): boolean {
  return (
    count(
      db.sql
        .prepare(
          `INSERT OR IGNORE INTO post_subscriptions (swarm_id, post_id, name, subscribed)
    VALUES (?, ?, ?, 1)`,
        )
        .run(swarmId, postId, name).changes,
    ) > 0
  );
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
    if (!postExists(db, swarmId, postId)) throw new BrokerError("not_found", `Post #${postId} not found.`);
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

/** Mention notices bypass the throttle; subscribers must not receive a duplicate for that comment. */
export function notifyComment(
  db: SwarmDb,
  comment: CommentView,
  title: string,
  now: number,
  mentionedRecipients: readonly string[] = [],
): boolean {
  const { swarmId, postId, author } = comment;
  const userAttention = recordUserCommentAttention(db, comment);
  const recentlyNotified = new Set(
    db.sql
      .prepare(
        `SELECT DISTINCT r.name FROM comment_notifications n
       JOIN messages m ON m.id = n.message_id
       JOIN message_recipients r ON r.message_id = m.id
       WHERE n.post_id = ? AND m.created_at > ?`,
      )
      .all(postId, now - COMMENT_NOTICE_WINDOW_MS)
      .map((row) => str(row, "name")),
  );
  const retiring = retiringWorkers(db, swarmId);
  const recipients = db.sql
    .prepare(
      `SELECT s.name FROM post_subscriptions s
      JOIN participants p ON p.swarm_id = s.swarm_id AND p.name = s.name
      WHERE s.swarm_id = ? AND s.post_id = ? AND s.subscribed = 1 AND s.name != ? AND p.retired_at IS NULL`,
    )
    .all(swarmId, postId, author)
    .map((row) => findParticipant(db, swarmId, str(row, "name")))
    .filter(
      (person): person is ParticipantRef =>
        person !== null &&
        !retiring.has(person.name) &&
        !mentionedRecipients.includes(person.name) &&
        !recentlyNotified.has(person.name) &&
        person.kind === "agent",
    );
  if (recipients.length === 0) return userAttention;
  const preview = Array.from(comment.text).slice(0, COMMENT_NOTICE_CHARS).join("");
  for (const person of recipients) {
    insertSystemNotice(db, {
      swarmId,
      recipient: person.name,
      text: `New comments on post #${postId} "${title}" (latest by ${author}: ${preview}). Read with swarm_posts_get.`,
      commentSource: { postId, commentId: comment.id },
      now,
    });
  }
  return userAttention;
}

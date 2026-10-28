import type { MessageView } from "../api-types.js";
import { SYSTEM_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { getMessages, unreadCounts } from "../store/message-queries.js";
import { count } from "../store/rows.js";

export function insertSystemNotice(
  db: SwarmDb,
  input: {
    swarmId: number;
    recipient: string;
    text: string;
    commentSource?: { postId: number; commentId: number };
    now: number;
  },
): MessageView {
  const { swarmId, recipient, now } = input;
  const threadId = count(
    db.sql
      .prepare("INSERT INTO threads (swarm_id, created_by, created_at) VALUES (?, ?, ?)")
      .run(swarmId, SYSTEM_NAME, now).lastInsertRowid,
  );
  const messageId = count(
    db.sql
      .prepare("INSERT INTO messages (swarm_id, thread_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(swarmId, threadId, SYSTEM_NAME, input.text, now).lastInsertRowid,
  );
  db.sql
    .prepare(
      `INSERT INTO message_recipients (message_id, swarm_id, name, position, status)
    VALUES (?, ?, ?, 0, 'pending')`,
    )
    .run(messageId, swarmId, recipient);
  if (input.commentSource) {
    db.sql
      .prepare("INSERT INTO comment_notifications (message_id, post_id, comment_id) VALUES (?, ?, ?)")
      .run(messageId, input.commentSource.postId, input.commentSource.commentId);
  }
  const [message] = getMessages(db, [messageId]);
  if (message === undefined) throw new Error(`System notice #${messageId} vanished inside its transaction`);
  insertEvent(db, swarmId, "message.created", { message, unread: unreadCounts(db, swarmId, [recipient]) }, now);
  return message;
}

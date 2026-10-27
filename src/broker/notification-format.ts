import type { MessageView } from "../api-types.js";
import { AGENT_TOOL } from "../constants.js";
import { formatDeliveredMessages } from "../message-format.js";
import type { SwarmDb } from "../store/db.js";
import { int, jsonList } from "../store/rows.js";

/** Keep subscription guidance once per wall thread without changing steering delivery. */
export function formatNotificationMessages(db: SwarmDb, messages: readonly MessageView[], recipient: string): string {
  if (messages.length === 0) return "";
  const notifications = new Map(
    db.sql
      .prepare(
        `SELECT n.message_id, n.post_id, COALESCE(s.subscribed, 0) AS subscribed
         FROM comment_notifications n
         LEFT JOIN post_subscriptions s ON s.post_id = n.post_id AND s.name = ?
         WHERE n.message_id IN (SELECT value FROM json_each(?))`,
      )
      .all(recipient, jsonList(messages.map((message) => message.id)))
      .map((row) => [
        int(row, "message_id"),
        { postId: int(row, "post_id"), subscribed: int(row, "subscribed") === 1 },
      ]),
  );
  const lastByPost = new Map<number, number>();
  for (const message of messages) {
    const notification = notifications.get(message.id);
    if (notification) lastByPost.set(notification.postId, message.id);
  }
  return formatDeliveredMessages(
    messages.map((message) => {
      const notification = notifications.get(message.id);
      if (!notification || lastByPost.get(notification.postId) !== message.id) return message;
      const { postId, subscribed } = notification;
      const status = subscribed
        ? `Subscribed to post #${postId}. Mute with ${AGENT_TOOL.postsUnsubscribe}({post_id: ${postId}}).`
        : `Not subscribed to post #${postId}. Search and read the post for discussion.`;
      return { ...message, text: `${message.text}\n\nSubscription: ${status}` };
    }),
    recipient,
  );
}

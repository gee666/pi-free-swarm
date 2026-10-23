import type { UserCommentsReadResponse } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { int, jsonList } from "../store/rows.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { postExists } from "../store/wall-queries.js";
import { emitUserPostAttention } from "./user-post-subscription.js";
import { markRead } from "./delivery-state.js";
import { BrokerError } from "./errors.js";
import { requireSwarm } from "./validate.js";

/** Mark only the rendered snapshot IDs read, never later arrivals. */
export function markUserCommentsRead(
  db: SwarmDb,
  swarmId: number,
  postId: number,
  commentIds: readonly number[],
  now: number,
): UserCommentsReadResponse {
  return db.write(() => {
    requireSwarm(db, swarmId);
    if (!Number.isSafeInteger(postId) || postId < 1)
      throw new BrokerError("validation", "postId must be a positive integer.", "postId");
    if (!postExists(db, swarmId, postId)) throw new BrokerError("not_found", `Post #${postId} not found.`);
    if (!Array.isArray(commentIds) || !commentIds.every((id) => Number.isSafeInteger(id) && id > 0))
      throw new BrokerError(
        "validation",
        "commentIds must contain positive integer comment IDs from this displayed post.",
        "commentIds",
      );
    const subscription = db.sql
      .prepare("SELECT subscribed FROM post_subscriptions WHERE swarm_id = ? AND post_id = ? AND name = ?")
      .get(swarmId, postId, USER_NAME);
    if (subscription?.subscribed !== 1)
      return { updated: 0, userUnread: userUnreadSummary(db, swarmId), userSubscribed: false };
    const ids = db.sql
      .prepare(
        `SELECT DISTINCT n.message_id FROM comment_notifications n
      JOIN comments c ON c.id = n.comment_id AND c.post_id = n.post_id
      JOIN message_recipients r ON r.message_id = n.message_id
      WHERE c.swarm_id = ? AND n.post_id = ? AND r.name = ?
      AND n.comment_id IN (SELECT value FROM json_each(?))`,
      )
      .all(swarmId, postId, USER_NAME, jsonList(commentIds))
      .map((row) => int(row, "message_id"));
    const updated = markRead(db, swarmId, USER_NAME, ids, now);
    const userUnread =
      updated > 0 ? emitUserPostAttention(db, swarmId, postId, now).userUnread : userUnreadSummary(db, swarmId);
    return { updated, userUnread, userSubscribed: true };
  });
}

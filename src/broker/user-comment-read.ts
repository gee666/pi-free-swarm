import type { UserCommentsReadResponse } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { readUserCommentAttention } from "../store/user-comment-attention.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { postExists } from "../store/wall-queries.js";
import { emitUserPostAttention } from "./user-post-subscription.js";
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
    const postRead = db.sql
      .prepare("UPDATE user_post_attention SET read_at = ? WHERE swarm_id = ? AND post_id = ? AND read_at IS NULL")
      .run(now, swarmId, postId).changes;
    const updated = readUserCommentAttention(db, swarmId, postId, commentIds, now) + Number(postRead);
    const userUnread =
      updated > 0 ? emitUserPostAttention(db, swarmId, postId, now).userUnread : userUnreadSummary(db, swarmId);
    return { updated, userUnread, userSubscribed: subscription?.subscribed === 1 };
  });
}

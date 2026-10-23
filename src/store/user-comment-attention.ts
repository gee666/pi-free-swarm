import type { CommentView } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { count, jsonList } from "./rows.js";

/** Wall attention is independent of private-message delivery. Caller owns the transaction. */
export function recordUserCommentAttention(db: SwarmDb, comment: CommentView): boolean {
  if (comment.author === USER_NAME) return false;
  return (
    count(
      db.sql
        .prepare(
          `INSERT INTO user_comment_attention (comment_id, swarm_id, post_id)
    SELECT ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM post_subscriptions WHERE swarm_id = ? AND post_id = ? AND name = ? AND subscribed = 1
    )`,
        )
        .run(comment.id, comment.swarmId, comment.postId, comment.swarmId, comment.postId, USER_NAME).changes,
    ) > 0
  );
}

export function readUserCommentAttention(
  db: SwarmDb,
  swarmId: number,
  postId: number,
  commentIds: readonly number[],
  now: number,
): number {
  return count(
    db.sql
      .prepare(
        `UPDATE user_comment_attention SET read_at = ?
    WHERE swarm_id = ? AND post_id = ? AND read_at IS NULL
    AND comment_id IN (SELECT value FROM json_each(?))`,
      )
      .run(now, swarmId, postId, jsonList(commentIds)).changes,
  );
}

import type { PostSummary } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int, jsonList } from "./rows.js";

type PostState = { userSubscribed: boolean; userUnreadComments: number };

/** One read snapshot for a whole displayed page; no per-post history scans. */
export function userPostStates(db: SwarmDb, swarmId: number, postIds: readonly number[]): Map<number, PostState> {
  const states = new Map<number, PostState>();
  if (!postIds.length) return states;
  const ids = jsonList(postIds);
  const rows = db.sql
    .prepare(
      `SELECT p.id, COALESCE(s.subscribed, 0) AS subscribed,
    CASE WHEN s.subscribed = 1 THEN COALESCE(u.unread, 0) ELSE 0 END AS unread
    FROM posts p LEFT JOIN post_subscriptions s ON s.post_id = p.id AND s.swarm_id = p.swarm_id AND s.name = ?
    LEFT JOIN (SELECT n.post_id, COUNT(*) AS unread FROM message_recipients r
      JOIN comment_notifications n ON n.message_id = r.message_id
      WHERE r.swarm_id = ? AND r.name = ? AND r.status IN ('pending', 'delivered')
      AND n.post_id IN (SELECT value FROM json_each(?)) GROUP BY n.post_id) u ON u.post_id = p.id
    WHERE p.swarm_id = ? AND p.id IN (SELECT value FROM json_each(?))`,
    )
    .all(USER_NAME, swarmId, USER_NAME, ids, swarmId, ids);
  for (const row of rows)
    states.set(int(row, "id"), {
      userSubscribed: int(row, "subscribed") === 1,
      userUnreadComments: int(row, "unread"),
    });
  return states;
}

export function postsForUser(db: SwarmDb, swarmId: number, posts: readonly PostSummary[]): PostSummary[] {
  const states = userPostStates(
    db,
    swarmId,
    posts.map((post) => post.id),
  );
  return posts.map((post) => ({ ...post, ...states.get(post.id) }));
}

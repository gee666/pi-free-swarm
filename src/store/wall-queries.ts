// Read side of the wall.
import type { PostDetailResponse, PostListResponse, PostSummary } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { commentOf, int, postOf } from "./rows.js";

const POST_SELECT = `
  SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p`;

/** Newest first. */
export function listPosts(db: SwarmDb, swarmId: number, page: { count: number; offset: number }): PostListResponse {
  const posts = db.sql
    .prepare(`${POST_SELECT} WHERE p.swarm_id = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`)
    .all(swarmId, page.count, page.offset)
    .map(postOf);
  const total = db.sql.prepare("SELECT COUNT(*) AS n FROM posts WHERE swarm_id = ?").get(swarmId);
  return { posts, total: total === undefined ? 0 : int(total, "n") };
}

export function getPost(db: SwarmDb, swarmId: number, postId: number): PostSummary | null {
  const row = db.sql.prepare(`${POST_SELECT} WHERE p.swarm_id = ? AND p.id = ?`).get(swarmId, postId);
  return row === undefined ? null : postOf(row);
}

/** Comments oldest first; `null` when the post is missing or belongs to another swarm. */
export function getPostDetail(db: SwarmDb, swarmId: number, postId: number): PostDetailResponse | null {
  const post = getPost(db, swarmId, postId);
  if (post === null) return null;
  const comments = db.sql.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY id").all(postId).map(commentOf);
  return { post, comments };
}

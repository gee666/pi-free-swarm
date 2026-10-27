import type { PostListResponse, PostSummary } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { commentOf, int, postOf } from "./rows.js";

const POST_SELECT = `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count FROM posts p`;

export function listPosts(db: SwarmDb, swarmId: number, page: { count: number; offset: number }): PostListResponse {
  const posts = db.sql
    .prepare(`${POST_SELECT} WHERE p.swarm_id = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`)
    .all(swarmId, page.count, page.offset)
    .map(postOf);
  const total = db.sql.prepare("SELECT COUNT(*) AS n FROM posts WHERE swarm_id = ?").get(swarmId);
  return { posts, total: total === undefined ? 0 : int(total, "n") };
}
export function postExists(db: SwarmDb, swarmId: number, postId: number): boolean {
  return db.sql.prepare("SELECT 1 FROM posts WHERE swarm_id = ? AND id = ?").get(swarmId, postId) !== undefined;
}
export function getPost(db: SwarmDb, swarmId: number, postId: number): PostSummary | null {
  const row = db.sql.prepare(`${POST_SELECT} WHERE p.swarm_id = ? AND p.id = ?`).get(swarmId, postId);
  return row === undefined ? null : postOf(row);
}
export function getPostDetail(db: SwarmDb, swarmId: number, postId: number) {
  const post = getPost(db, swarmId, postId);
  if (!post) return null;
  const comments = db.sql.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY id").all(postId).map(commentOf);
  return { post, comments };
}

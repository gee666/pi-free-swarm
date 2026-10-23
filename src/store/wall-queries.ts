// Read side of the wall.
import type { PostContract, PostDetailResponse, PostListResponse, PostSummary } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { commentOf, int, postOf, type Row } from "./rows.js";
import { listPostClaims } from "./post-claims.js";
import { getPostContract } from "./post-contracts.js";

const POST_SELECT = `
  SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p`;

function projectPost(db: SwarmDb, swarmId: number, row: Row): { post: PostSummary; contract: PostContract | null } {
  const post = postOf(row);
  const contract = getPostContract(db, swarmId, post.id);
  return {
    post: {
      ...post,
      claims: listPostClaims(db, swarmId, post.id),
      contract: contract
        ? {
            postId: contract.postId,
            revision: contract.revision,
            updatedBy: contract.updatedBy,
            updatedAt: contract.updatedAt,
          }
        : null,
    },
    contract,
  };
}

function readPost(db: SwarmDb, swarmId: number, postId: number) {
  const row = db.sql.prepare(`${POST_SELECT} WHERE p.swarm_id = ? AND p.id = ?`).get(swarmId, postId);
  return row === undefined ? null : projectPost(db, swarmId, row);
}

/** Newest first. */
export function listPosts(db: SwarmDb, swarmId: number, page: { count: number; offset: number }): PostListResponse {
  const posts = db.sql
    .prepare(`${POST_SELECT} WHERE p.swarm_id = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`)
    .all(swarmId, page.count, page.offset)
    .map((row) => projectPost(db, swarmId, row).post);
  const total = db.sql.prepare("SELECT COUNT(*) AS n FROM posts WHERE swarm_id = ?").get(swarmId);
  return { posts, total: total === undefined ? 0 : int(total, "n") };
}

export function postExists(db: SwarmDb, swarmId: number, postId: number): boolean {
  return db.sql.prepare("SELECT 1 FROM posts WHERE swarm_id = ? AND id = ?").get(swarmId, postId) !== undefined;
}

export function getPost(db: SwarmDb, swarmId: number, postId: number): PostSummary | null {
  return readPost(db, swarmId, postId)?.post ?? null;
}

/** Comments oldest first; `null` when the post is missing or belongs to another swarm. */
export function getPostDetail(db: SwarmDb, swarmId: number, postId: number): PostDetailResponse | null {
  const record = readPost(db, swarmId, postId);
  if (record === null) return null;
  const comments = db.sql.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY id").all(postId).map(commentOf);
  return { ...record, comments };
}

import type { CommentView, PostListResponse } from "../api-types.js";
import { PAGE_MAX_COUNT } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { commentOf, int, postOf } from "./rows.js";

/** Oldest first, including pre-existing history on first use. This read never advances coverage. */
export function listFreshPosts(db: SwarmDb, swarmId: number, reader: string, count: number): PostListResponse {
  checkCount(count);
  return db.write(() => {
    const posts = db.sql
      .prepare(
        `
      SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
      FROM posts p WHERE p.swarm_id = ? AND NOT EXISTS (
        SELECT 1 FROM post_coverage r WHERE r.swarm_id = p.swarm_id AND r.name = ? AND r.post_id = p.id
      ) ORDER BY p.id LIMIT ?`,
      )
      .all(swarmId, reader, count)
      .map(postOf);
    const row = db.sql
      .prepare(
        `
      SELECT COUNT(*) AS n FROM posts p WHERE p.swarm_id = ? AND NOT EXISTS (
        SELECT 1 FROM post_coverage r WHERE r.swarm_id = p.swarm_id AND r.name = ? AND r.post_id = p.id
      )`,
      )
      .get(swarmId, reader);
    return { posts, total: row === undefined ? 0 : int(row, "n") };
  });
}

export function listFreshComments(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  postId: number,
  count: number,
): { comments: CommentView[]; total: number } {
  checkCount(count);
  return db.write(() => {
    const comments = db.sql
      .prepare(
        `
      SELECT c.* FROM comments c WHERE c.swarm_id = ? AND c.post_id = ? AND NOT EXISTS (
        SELECT 1 FROM comment_coverage r WHERE r.swarm_id = c.swarm_id AND r.name = ? AND r.comment_id = c.id
      ) ORDER BY c.id LIMIT ?`,
      )
      .all(swarmId, postId, reader, count)
      .map(commentOf);
    const row = db.sql
      .prepare(
        `
      SELECT COUNT(*) AS n FROM comments c WHERE c.swarm_id = ? AND c.post_id = ? AND NOT EXISTS (
        SELECT 1 FROM comment_coverage r WHERE r.swarm_id = c.swarm_id AND r.name = ? AND r.comment_id = c.id
      )`,
      )
      .get(swarmId, postId, reader);
    return { comments, total: row === undefined ? 0 : int(row, "n") };
  });
}

/** Call only for complete bodies actually returned or observed entering the current worker's context. */
export function markPostsCovered(db: SwarmDb, swarmId: number, reader: string, ids: readonly number[]): void {
  db.write(({ sql }) => {
    const insert = sql.prepare(`INSERT OR IGNORE INTO post_coverage (swarm_id, name, post_id)
      SELECT swarm_id, ?, id FROM posts WHERE swarm_id = ? AND id = ?`);
    for (const id of ids) insert.run(reader, swarmId, id);
  });
}

export function markCommentsCovered(db: SwarmDb, swarmId: number, reader: string, ids: readonly number[]): void {
  db.write(({ sql }) => {
    const insert = sql.prepare(`INSERT OR IGNORE INTO comment_coverage (swarm_id, name, comment_id)
      SELECT swarm_id, ?, id FROM comments WHERE swarm_id = ? AND id = ?`);
    for (const id of ids) insert.run(reader, swarmId, id);
  });
}

/** Replay after compaction remains explicit and independent for each stream/object. */
export function resetPostCoverage(db: SwarmDb, swarmId: number, reader: string): void {
  db.write(({ sql }) => {
    sql.prepare("DELETE FROM post_coverage WHERE swarm_id = ? AND name = ?").run(swarmId, reader);
  });
}

export function resetCommentCoverage(db: SwarmDb, swarmId: number, reader: string, postId: number): void {
  db.write(({ sql }) => {
    sql
      .prepare(
        `DELETE FROM comment_coverage WHERE swarm_id = ? AND name = ?
      AND comment_id IN (SELECT id FROM comments WHERE swarm_id = ? AND post_id = ?)`,
      )
      .run(swarmId, reader, swarmId, postId);
  });
}

function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > PAGE_MAX_COUNT) {
    throw new RangeError(`count must be an integer from 1 to ${PAGE_MAX_COUNT}.`);
  }
}

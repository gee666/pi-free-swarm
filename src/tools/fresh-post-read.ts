import { checkPage, requireParticipant, requireSwarm } from "../broker/validate.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { int, postOf } from "../store/rows.js";
import { markPostsCovered } from "../store/wall-coverage.js";
import { readPosition, renderReadPage } from "./read-page.js";

export function readFreshPostsTool(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  input: { count?: number; after?: string },
): string {
  const count = input.count ?? PAGE_DEFAULT_COUNT;
  checkPage({ count, offset: 0 });
  requireSwarm(db, swarmId);
  requireParticipant(db, swarmId, reader);
  return db.write(() => {
    const row = db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM posts WHERE swarm_id = ?").get(swarmId);
    const position = readPosition(input.after, `posts:${swarmId}:${reader}`, row === undefined ? 0 : int(row, "id"));
    const posts = db.sql
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
      FROM posts p WHERE p.swarm_id = ? AND p.id >= ? AND p.id <= ? AND NOT EXISTS (
      SELECT 1 FROM post_coverage r WHERE r.swarm_id = p.swarm_id AND r.name = ? AND r.post_id = p.id)
      ORDER BY p.id LIMIT ?`,
      )
      .all(swarmId, position.id, position.snapshot, reader, count + 1)
      .map(postOf);
    const page = renderReadPage(
      "Only-new posts · oldest first · full bodies",
      posts.map((post) => ({
        id: post.id,
        label: `Post #${post.id}: ${post.title} · ${post.author}`,
        text: post.text,
      })),
      position,
      count,
    );
    markPostsCovered(db, swarmId, reader, page.completeIds);
    return page.text;
  });
}

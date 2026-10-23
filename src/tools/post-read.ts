import { BrokerError } from "../broker/errors.js";
import { checkPage, requireParticipant, requireSwarm } from "../broker/validate.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { commentOf, int } from "../store/rows.js";
import { getPost } from "../store/wall-queries.js";
import { markCommentsCovered, markPostsCovered } from "../store/wall-coverage.js";
import { timeAgo } from "../wall-format.js";
import { readPosition, renderReadPage, type ReadItem } from "./read-page.js";
import { withWatcherAttachment } from "./watcher-attachment.js";

export function readPostTool(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  input: { post_id: number; count?: number; after?: string; only_new?: boolean },
  now = Date.now(),
): string {
  const count = input.count ?? PAGE_DEFAULT_COUNT;
  checkPage({ count, offset: 0 });
  requireSwarm(db, swarmId);
  requireParticipant(db, swarmId, reader);
  return db.write(() => {
    const post = getPost(db, swarmId, input.post_id);
    if (post === null) throw new BrokerError("not_found", `Post #${input.post_id} not found.`);
    const row = db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM comments WHERE post_id = ?").get(post.id);
    const position = readPosition(
      input.after,
      `post:${swarmId}:${post.id}:${reader}:${input.only_new === true}`,
      row === undefined ? 0 : int(row, "id"),
    );
    const covered = db.sql
      .prepare("SELECT 1 FROM post_coverage WHERE swarm_id = ? AND name = ? AND post_id = ?")
      .get(swarmId, reader, post.id);
    const items: ReadItem[] = [];
    if (position.id === 0 && (!input.only_new || covered === undefined)) {
      items.push(
        withWatcherAttachment(db, swarmId, reader, "post", post.id, {
          id: 0,
          label: `#${post.id} ${post.author} · ${timeAgo(post.createdAt, now)} · ${post.title}`,
          text: post.text,
        }),
      );
    }
    const rows = db.sql
      .prepare(
        `SELECT c.* FROM comments c WHERE c.swarm_id = ? AND c.post_id = ? AND c.id >= ? AND c.id <= ?
      ${input.only_new ? "AND NOT EXISTS (SELECT 1 FROM comment_coverage r WHERE r.swarm_id = c.swarm_id AND r.name = ? AND r.comment_id = c.id)" : ""}
      ORDER BY c.id LIMIT ?`,
      )
      .all(
        ...(input.only_new
          ? [swarmId, post.id, position.id, position.snapshot, reader, count + 1]
          : [swarmId, post.id, position.id, position.snapshot, count + 1]),
      );
    items.push(
      ...rows.map(commentOf).map((comment) =>
        withWatcherAttachment(db, swarmId, reader, "comment", comment.id, {
          id: comment.id,
          label: `#${comment.id} ${comment.author} · ${timeAgo(comment.createdAt, now)}`,
          text: comment.text,
        }),
      ),
    );
    const page = renderReadPage(`Post #${post.id} · ${post.title}`, items, position, count);
    if (page.completeIds.includes(0)) markPostsCovered(db, swarmId, reader, [post.id]);
    markCommentsCovered(
      db,
      swarmId,
      reader,
      page.completeIds.filter((id) => id !== 0),
    );
    return page.text;
  });
}

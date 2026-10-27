import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { commentOf, int, text } from "../store/rows.js";
import { getPost } from "../store/wall-queries.js";
import { listPostLinks } from "../store/post-links.js";
import { requireParticipant, requireSwarm, checkPage } from "./validate.js";
import { BrokerError } from "./errors.js";

export function searchPostCandidates(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  filters: { author?: string; taskId?: number; criterionId?: number; subscribed?: boolean } = {},
) {
  return db.read(() => {
    requireSwarm(db, swarmId);
    const reader = requireParticipant(db, swarmId, actor);
    return db.sql
      .prepare(
        `SELECT p.*, p.body || char(10) || COALESCE((SELECT group_concat(c.body, char(10)) FROM comments c WHERE c.post_id = p.id), '') AS indexed_text
    FROM posts p WHERE p.swarm_id = ?
    AND (? IS NULL OR p.author = ? COLLATE NOCASE)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM post_links l WHERE l.post_id = p.id AND l.target_kind = 'task' AND l.target_id = ?))
    AND (? IS NULL OR EXISTS (SELECT 1 FROM post_links l WHERE l.post_id = p.id AND l.target_kind = 'criterion' AND l.target_id = ?))
    AND (? IS NULL OR EXISTS (SELECT 1 FROM post_subscriptions s WHERE s.post_id = p.id AND s.name = ? AND s.subscribed = 1) = ?)
    ORDER BY COALESCE((SELECT MAX(c.created_at) FROM comments c WHERE c.post_id = p.id), p.created_at) DESC, p.id DESC`,
      )
      .all(
        swarmId,
        filters.author ?? null,
        filters.author ?? null,
        filters.taskId ?? null,
        filters.taskId ?? null,
        filters.criterionId ?? null,
        filters.criterionId ?? null,
        filters.subscribed === undefined ? null : Number(filters.subscribed),
        reader.name,
        Number(filters.subscribed ?? false),
      )
      .map((row) => ({
        id: String(int(row, "id")),
        title: text(row, "title"),
        text: text(row, "indexed_text"),
        author: text(row, "author"),
      }));
  });
}
export function getPostPage(db: SwarmDb, swarmId: number, id: number, after = 0, limit = PAGE_DEFAULT_COUNT) {
  return db.read(() => {
    requireSwarm(db, swarmId);
    checkPage({ count: limit, offset: after });
    const post = getPost(db, swarmId, id);
    if (!post) throw new BrokerError("not_found", `Post #${id} not found.`);
    const comments = db.sql
      .prepare("SELECT * FROM comments WHERE post_id = ? AND id > ? ORDER BY id LIMIT ?")
      .all(id, after, limit + 1)
      .map(commentOf);
    return {
      post,
      comments: comments.slice(0, limit),
      links: listPostLinks(db, id),
      nextAfter: comments.length > limit ? (comments[limit - 1]?.id ?? null) : null,
    };
  });
}

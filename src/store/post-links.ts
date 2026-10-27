import type { SwarmDb } from "./db.js";
import { count, int } from "./rows.js";
import { enumText } from "./work-rows.js";

export interface PostLink {
  postId: number;
  targetKind: "task" | "criterion";
  targetId: number;
}
export function listPostLinks(db: SwarmDb, postId: number): PostLink[] {
  return db.sql
    .prepare("SELECT * FROM post_links WHERE post_id = ? ORDER BY target_kind, target_id")
    .all(postId)
    .map((row) => ({
      postId: int(row, "post_id"),
      targetKind: enumText(row, "target_kind", ["task", "criterion"]),
      targetId: int(row, "target_id"),
    }));
}
export function linkedPostIds(db: SwarmDb, kind: "task" | "criterion", id: number): number[] {
  return db.sql
    .prepare("SELECT post_id FROM post_links WHERE target_kind = ? AND target_id = ? ORDER BY post_id")
    .all(kind, id)
    .map((row) => int(row, "post_id"));
}
export function changePostLink(db: SwarmDb, link: PostLink, remove: boolean): boolean {
  const result = remove
    ? db.sql
        .prepare("DELETE FROM post_links WHERE post_id = ? AND target_kind = ? AND target_id = ?")
        .run(link.postId, link.targetKind, link.targetId)
    : db.sql
        .prepare("INSERT OR IGNORE INTO post_links(post_id, target_kind, target_id) VALUES (?, ?, ?)")
        .run(link.postId, link.targetKind, link.targetId);
  return count(result.changes) > 0;
}

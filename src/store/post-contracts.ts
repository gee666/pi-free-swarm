import type { PostContract } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { int, text } from "./rows.js";

export function getPostContract(db: SwarmDb, swarmId: number, postId: number): PostContract | null {
  const row = db.sql.prepare("SELECT * FROM post_contracts WHERE swarm_id = ? AND post_id = ?").get(swarmId, postId);
  return row
    ? {
        postId: int(row, "post_id"),
        revision: int(row, "revision"),
        text: text(row, "text"),
        updatedBy: text(row, "updated_by"),
        updatedAt: int(row, "updated_at"),
      }
    : null;
}

/** Revision checks and the outbox event share the caller's write transaction. */
export function savePostContract(db: SwarmDb, swarmId: number, contract: PostContract): void {
  db.sql
    .prepare(
      `INSERT INTO post_contracts (swarm_id, post_id, revision, text, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (post_id) DO UPDATE SET revision = excluded.revision, text = excluded.text,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(swarmId, contract.postId, contract.revision, contract.text, contract.updatedBy, contract.updatedAt);
}

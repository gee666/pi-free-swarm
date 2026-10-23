import type { PostClaim } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { count, int, text, type Row } from "./rows.js";

function claimOf(row: Row): PostClaim {
  return {
    postId: int(row, "post_id"),
    role: text(row, "role"),
    agent: text(row, "agent"),
    createdAt: int(row, "created_at"),
  };
}

export function listPostClaims(db: SwarmDb, swarmId: number, postId: number): PostClaim[] {
  return db.sql
    .prepare("SELECT * FROM post_claims WHERE swarm_id = ? AND post_id = ? ORDER BY created_at, role")
    .all(swarmId, postId)
    .map(claimOf);
}

export function findPostClaim(db: SwarmDb, swarmId: number, postId: number, role: string): PostClaim | null {
  const row = db.sql
    .prepare("SELECT * FROM post_claims WHERE swarm_id = ? AND post_id = ? AND role = ?")
    .get(swarmId, postId, role);
  return row ? claimOf(row) : null;
}

/** Caller owns the claim-and-event transaction; uniqueness arbitrates competing processes. */
export function insertPostClaim(db: SwarmDb, swarmId: number, claim: PostClaim): boolean {
  return (
    count(
      db.sql
        .prepare(
          `INSERT INTO post_claims (swarm_id, post_id, role, agent, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (post_id, role) DO NOTHING`,
        )
        .run(swarmId, claim.postId, claim.role, claim.agent, claim.createdAt).changes,
    ) > 0
  );
}

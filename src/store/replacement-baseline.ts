import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";

const INITIAL_REPLACEMENT_POSTS = 10;

/** Deliberate replacement catch-up window, never a claim that omitted posts were delivered. */
export function seedReplacementPostBaseline(db: SwarmDb, swarmId: number, name: string): number {
  return db.write(({ sql }) => {
    const row = sql
      .prepare("SELECT id FROM posts WHERE swarm_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?")
      .get(swarmId, INITIAL_REPLACEMENT_POSTS - 1);
    const first = row === undefined ? 0 : int(row, "id");
    sql
      .prepare(
        `INSERT OR IGNORE INTO replacement_post_baselines (swarm_id, name, first_post_id)
      VALUES (?, ?, ?)`,
      )
      .run(swarmId, name, first);
    return replacementPostBaseline(db, swarmId, name);
  });
}

export function replacementPostBaseline(db: SwarmDb, swarmId: number, name: string): number {
  const row = db.sql
    .prepare("SELECT first_post_id FROM replacement_post_baselines WHERE swarm_id = ? AND name = ?")
    .get(swarmId, name);
  return row === undefined ? 0 : int(row, "first_post_id");
}

export function hasReplacementPostBaseline(db: SwarmDb, swarmId: number, name: string): boolean {
  return (
    db.sql.prepare("SELECT 1 FROM replacement_post_baselines WHERE swarm_id = ? AND name = ?").get(swarmId, name) !==
    undefined
  );
}

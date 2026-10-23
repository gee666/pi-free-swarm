import type { SwarmDb } from "./db.js";

/** Legacy positive totals remain usable; an unverified zero is never proof of free usage. */
export function hasUnverifiedUsageCost(db: SwarmDb, swarmId: number): boolean {
  return (
    db.sql
      .prepare(
        `SELECT 1 FROM usage WHERE swarm_id = ?
    AND (cost_reported = 0 OR (cost_reported IS NULL AND cost <= 0)) LIMIT 1`,
      )
      .get(swarmId) !== undefined
  );
}

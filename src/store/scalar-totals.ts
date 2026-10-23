import type { SwarmDb } from "./db.js";
import { int, real } from "./rows.js";

/** Authoritative reported totals only; never build per-agent records or infer category prices. */
export function swarmUsageTotals(db: SwarmDb, swarmId: number): { costUsd: number; tokens: number } {
  const row = db.sql
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS cost,
      COALESCE(SUM(input + output + cache_read + cache_write), 0) AS tokens
     FROM usage WHERE swarm_id = ?`,
    )
    .get(swarmId);
  return { costUsd: row ? real(row, "cost") : 0, tokens: row ? int(row, "tokens") : 0 };
}

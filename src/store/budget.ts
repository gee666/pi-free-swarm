import type { BudgetStatus } from "../budget.js";
import type { SwarmSettings } from "../settings.js";
import type { SwarmDb } from "./db.js";
import { getStats } from "./stats-queries.js";

export const BUDGET_ACCOUNTING =
  "Cumulative reported worker and Watcher usage, including reported retries and compaction; active run wall time excludes stopped time. Main and external billing are excluded. Delayed usage and in-flight work may overshoot. Interrupted external effects are uncertain; inspect artifacts before retrying.";

type BudgetPolicy = Pick<SwarmSettings, "budgetMoneyUsd" | "budgetTimeSeconds" | "gracefulShutdownOnBudget">;

export function readBudget(db: SwarmDb, swarmId: number, settings: BudgetPolicy, now: number): BudgetStatus {
  const stats = getStats(db, swarmId, now);
  const costUsd = stats?.totals.cost ?? 0;
  const activeTimeMs = stats?.totals.wallTimeMs ?? 0;
  const moneyUsd = settings.budgetMoneyUsd ?? null;
  const timeSeconds = settings.budgetTimeSeconds ?? null;
  const exhausted =
    moneyUsd !== null && costUsd >= moneyUsd
      ? "money"
      : timeSeconds !== null && activeTimeMs >= timeSeconds * 1000
        ? "time"
        : null;
  const stopped = db.sql
    .prepare(
      "SELECT 1 FROM budget_stops WHERE swarm_id = ? AND run = (SELECT run_count FROM swarms WHERE id = budget_stops.swarm_id)",
    )
    .get(swarmId);
  return {
    moneyUsd,
    timeSeconds,
    costUsd,
    activeTimeMs,
    gracefulShutdown: settings.gracefulShutdownOnBudget ?? false,
    exhausted,
    stopReason: stopped ? "budget-exhausted" : null,
    moneyOvershootUsd: moneyUsd === null ? 0 : Math.max(0, costUsd - moneyUsd),
    timeOvershootSeconds: timeSeconds === null ? 0 : Math.max(0, activeTimeMs / 1000 - timeSeconds),
    accounting: BUDGET_ACCOUNTING,
  };
}

export function recordBudgetStop(
  db: SwarmDb,
  swarmId: number,
  run: number,
  reason: "money" | "time",
  now: number,
): void {
  const stats = getStats(db, swarmId, now);
  db.write(() =>
    db.sql
      .prepare(
        "INSERT OR IGNORE INTO budget_stops (swarm_id, run, reason, cost_usd, active_time_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(swarmId, run, reason, stats?.totals.cost ?? 0, stats?.totals.wallTimeMs ?? 0, now),
  );
}

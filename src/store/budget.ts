import type { BudgetStatus } from "../budget.js";
import type { SwarmSettings } from "../settings.js";
import type { UsageSample } from "../runtime-types.js";
import { getRunConfiguration } from "./run-configuration.js";
import type { SwarmDb } from "./db.js";
import { getStats } from "./stats-queries.js";

export const BUDGET_ACCOUNTING =
  "Cumulative reported worker and Watcher usage, including reported retries and compaction; active run wall time excludes stopped time. Main and external billing are excluded. Delayed usage and in-flight work may overshoot. Graceful mode drains the active pi turn, which can include further tool steps and already accepted steering, not a per-tool boundary. Interrupted external effects are uncertain; inspect artifacts before retrying.";

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
    accounting:
      BUDGET_ACCOUNTING +
      (hasBudgetAccountingGap(db, swarmId)
        ? " Accounting is incomplete: usage lacked a valid cost or reported an unexpected model. A money-budget resume is refused; missing cost is not free usage."
        : ""),
  };
}

export function hasBudgetAccountingGap(db: SwarmDb, swarmId: number): boolean {
  return db.sql.prepare("SELECT 1 FROM budget_accounting_gaps WHERE swarm_id = ? LIMIT 1").get(swarmId) !== undefined;
}

/** Preserve known usage before callers stop a money-limited run on incomplete attribution. */
export function checkUsageAccounting(
  db: SwarmDb,
  swarmId: number,
  agent: string,
  sample: UsageSample,
  now: number,
): void {
  const config = getRunConfiguration(db, swarmId);
  const assigned = config?.effective.workers.find((worker) => worker.name === agent);
  const unexpectedModel = assigned && sample.model !== null && sample.model !== assigned.modelId;
  if (sample.costKnown !== false && !unexpectedModel) return;
  const reason = unexpectedModel ? "unexpected model" : "missing USD usage total";
  db.write(() =>
    db.sql
      .prepare("INSERT OR IGNORE INTO budget_accounting_gaps (swarm_id, agent, reason, created_at) VALUES (?, ?, ?, ?)")
      .run(swarmId, agent, reason, now),
  );
  if (config && config.effective.budget.moneyUsd !== null) {
    throw new Error(
      `Money budget accounting is incomplete for ${agent}: ${reason}. Execution stopped; costs are not zero. Inspect usage and pricing before resuming without a money limit.`,
    );
  }
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

import { mergeBudgetRaises, type BudgetRaises, type BudgetStatus } from "../budget.js";
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
  const { moneyUsd, timeSeconds } = mergeBudgetRaises(
    {
      moneyUsd: settings.budgetMoneyUsd ?? null,
      timeSeconds: settings.budgetTimeSeconds ?? null,
    },
    getBudgetRaises(db, swarmId),
  );
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

export function getBudgetRaises(db: SwarmDb, swarmId: number): BudgetRaises {
  // A committed revision survives interruption before its request reaches "applied".
  const row = db.sql
    .prepare(
      `WITH ceilings AS (
        SELECT json_extract(change, '$.moneyUsd') AS money_usd,
          json_extract(change, '$.timeSeconds') AS time_seconds
        FROM configuration_requests
        WHERE swarm_id = ? AND status = 'applied' AND json_extract(change, '$.type') = 'raiseBudget'
        UNION ALL
        SELECT
          CASE WHEN json_extract(r.configuration, '$.budget.moneyUsd') > json_extract(i.configuration, '$.budget.moneyUsd')
            THEN json_extract(r.configuration, '$.budget.moneyUsd') END,
          CASE WHEN json_extract(r.configuration, '$.budget.timeSeconds') > json_extract(i.configuration, '$.budget.timeSeconds')
            THEN json_extract(r.configuration, '$.budget.timeSeconds') END
        FROM run_configuration_revisions r JOIN run_configurations i USING (swarm_id, run)
        WHERE r.swarm_id = ?
      ) SELECT MAX(money_usd) AS money_usd, MAX(time_seconds) AS time_seconds FROM ceilings`,
    )
    .get(swarmId, swarmId);
  return {
    ...(typeof row?.money_usd === "number" ? { moneyUsd: row.money_usd } : {}),
    ...(typeof row?.time_seconds === "number" ? { timeSeconds: row.time_seconds } : {}),
  };
}

export function hasBudgetAccountingGap(db: SwarmDb, swarmId: number): boolean {
  return db.sql.prepare("SELECT 1 FROM budget_accounting_gaps WHERE swarm_id = ? LIMIT 1").get(swarmId) !== undefined;
}

/** Return the fatal issue so callers can commit usage and gap together before throwing. */
export function checkUsageAccounting(
  db: SwarmDb,
  swarmId: number,
  agent: string,
  sample: UsageSample,
  now: number,
  originRun?: number,
): Error | undefined {
  const config = getRunConfiguration(db, swarmId, originRun);
  const assigned = config?.effective.workers.find((worker) => worker.name === agent);
  const archived = !assigned
    ? db.sql
        .prepare("SELECT retired_model_id FROM participants WHERE swarm_id = ? AND name = ? AND retired_at IS NOT NULL")
        .get(swarmId, agent)
    : undefined;
  const expectedModel =
    assigned?.modelId ?? (typeof archived?.retired_model_id === "string" ? archived.retired_model_id : undefined);
  const unexpectedModel = expectedModel !== undefined && sample.model !== null && sample.model !== expectedModel;
  if (sample.costKnown !== false && !unexpectedModel) return;
  const reason = unexpectedModel ? "unexpected model" : "missing USD usage total";
  db.write(() =>
    db.sql
      .prepare("INSERT OR IGNORE INTO budget_accounting_gaps (swarm_id, agent, reason, created_at) VALUES (?, ?, ?, ?)")
      .run(swarmId, agent, reason, now),
  );
  if (config && config.effective.budget.moneyUsd !== null) {
    return new Error(
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

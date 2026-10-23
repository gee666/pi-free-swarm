import type { BudgetRaises, BudgetStatus } from "../budget.js";
import type { SwarmSettings } from "../settings.js";
import type { UsageSample } from "../runtime-types.js";
import { getRunConfiguration } from "./run-configuration.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";
import { swarmUsageTotals } from "./scalar-totals.js";

export const BUDGET_ACCOUNTING =
  "Cumulative persisted worker and Watcher usage, including reported tool costs, other native usage, retries and compaction; active run wall time excludes stopped time. Main and external billing are excluded. Reports lost on abrupt failure are not estimated. Delayed usage and in-flight work may overshoot. Graceful mode drains the active pi turn, which can include further tool steps and already accepted steering, not a per-tool boundary. Interrupted external effects are uncertain; inspect artifacts before retrying.";

type BudgetPolicy = Pick<SwarmSettings, "budgetMoneyUsd" | "budgetTimeSeconds" | "gracefulShutdownOnBudget">;

export function readBudget(db: SwarmDb, swarmId: number, settings: BudgetPolicy, now: number): BudgetStatus {
  const { costUsd, activeTimeMs, hasInterruptedRuns } = budgetTotals(db, swarmId, now);
  const { moneyUsd, timeSeconds, gracefulShutdown } = currentBudgetPolicy(db, swarmId) ?? {
    moneyUsd: settings.budgetMoneyUsd ?? null,
    timeSeconds: settings.budgetTimeSeconds ?? null,
    gracefulShutdown: settings.gracefulShutdownOnBudget ?? false,
  };
  const hasAccountingGaps = hasBudgetAccountingGap(db, swarmId);
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
    gracefulShutdown,
    exhausted,
    stopReason: stopped ? "budget-exhausted" : null,
    moneyOvershootUsd: moneyUsd === null ? 0 : Math.max(0, costUsd - moneyUsd),
    timeOvershootSeconds: timeSeconds === null ? 0 : Math.max(0, activeTimeMs / 1000 - timeSeconds),
    hasAccountingGaps,
    hasInterruptedRuns,
    accounting:
      BUDGET_ACCOUNTING +
      (hasAccountingGaps
        ? " Accounting is incomplete or unverified: a total is missing, a worker model mismatched, or legacy reporting provenance is unavailable. A money-budget resume is refused; missing cost is not free usage."
        : "") +
      (hasInterruptedRuns
        ? " Interrupted history may have an unobserved final interval. Recovery uses the latest recorded heartbeat or same-run worker usage/spans, not the later discovery time; this is not an exact death time."
        : ""),
  };
}

function budgetTotals(
  db: SwarmDb,
  swarmId: number,
  now: number,
): { costUsd: number; activeTimeMs: number; hasInterruptedRuns: boolean } {
  const { costUsd } = swarmUsageTotals(db, swarmId);
  const time = db.sql
    .prepare(
      "SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS elapsed, COALESCE(MAX(end_status = 'interrupted'), 0) AS interrupted FROM swarm_runs WHERE swarm_id = ?",
    )
    .get(now, swarmId);
  return {
    costUsd,
    activeTimeMs: time ? int(time, "elapsed") : 0,
    hasInterruptedRuns: time ? int(time, "interrupted") === 1 : false,
  };
}

function isStoredCeiling(value: unknown, jsonType: unknown): value is number | null {
  return value === null
    ? jsonType === "null"
    : (jsonType === "integer" || jsonType === "real") &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0;
}

function currentBudgetPolicy(
  db: SwarmDb,
  swarmId: number,
): Pick<BudgetStatus, "moneyUsd" | "timeSeconds" | "gracefulShutdown"> | undefined {
  const row = db.sql
    .prepare(
      `SELECT json_extract(configuration, '$.budget.moneyUsd') AS money_usd,
      json_type(configuration, '$.budget.moneyUsd') AS money_type,
      json_extract(configuration, '$.budget.timeSeconds') AS time_seconds,
      json_type(configuration, '$.budget.timeSeconds') AS time_type,
      json_type(configuration, '$.budget.gracefulShutdown') AS graceful_type
    FROM (SELECT COALESCE(
      (SELECT r.configuration FROM run_configuration_revisions r
        WHERE r.swarm_id = s.id AND r.run = s.run_count ORDER BY r.revision DESC LIMIT 1),
      i.configuration) AS configuration
      FROM swarms s LEFT JOIN run_configurations i ON i.swarm_id = s.id AND i.run = s.run_count
      WHERE s.id = ?) WHERE configuration IS NOT NULL`,
    )
    .get(swarmId);
  if (!row) return undefined;
  const moneyUsd = row.money_usd;
  const timeSeconds = row.time_seconds;
  if (
    !isStoredCeiling(moneyUsd, row.money_type) ||
    !isStoredCeiling(timeSeconds, row.time_type) ||
    (row.graceful_type !== "true" && row.graceful_type !== "false")
  ) {
    throw new Error("Stored effective budget policy is invalid; inspect its configuration before continuing.");
  }
  return { moneyUsd, timeSeconds, gracefulShutdown: row.graceful_type === "true" };
}

export function getBudgetRaises(db: SwarmDb, swarmId: number): BudgetRaises {
  // Committed revisions survive interrupted requests. Compare consecutive policies so a reset
  // to the initial value is still an override, while unrelated roster revisions pin no defaults.
  const rows = db.sql
    .prepare(
      `WITH history AS (
        SELECT run, 0 AS revision, configuration FROM run_configurations WHERE swarm_id = ?
        UNION ALL
        SELECT run, revision, configuration FROM run_configuration_revisions WHERE swarm_id = ?
      ), policies AS (
        SELECT *, LAG(configuration) OVER (PARTITION BY run ORDER BY revision) AS previous FROM history
      ), ceilings AS (
        SELECT run, expected_revision + 1 AS revision, 0 AS priority,
          json_extract(change, '$.moneyUsd') AS money_usd,
          json_extract(change, '$.timeSeconds') AS time_seconds
        FROM configuration_requests
        WHERE swarm_id = ? AND status = 'applied' AND json_extract(change, '$.type') = 'raiseBudget'
        UNION ALL
        SELECT run, revision, 1 AS priority,
          CASE WHEN json_extract(configuration, '$.budget.moneyUsd') IS NOT json_extract(previous, '$.budget.moneyUsd')
            THEN json_extract(configuration, '$.budget.moneyUsd') END,
          CASE WHEN json_extract(configuration, '$.budget.timeSeconds') IS NOT json_extract(previous, '$.budget.timeSeconds')
            THEN json_extract(configuration, '$.budget.timeSeconds') END
        FROM policies WHERE revision > 0
      ) SELECT money_usd, time_seconds FROM ceilings ORDER BY run, revision, priority`,
    )
    .all(swarmId, swarmId, swarmId);
  const ceilings: BudgetRaises = {};
  for (const row of rows) {
    if (typeof row.money_usd === "number") ceilings.moneyUsd = row.money_usd;
    if (typeof row.time_seconds === "number") ceilings.timeSeconds = row.time_seconds;
  }
  return ceilings;
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
  // Service receipts may name a different model without changing the worker's assignment.
  if (sample.costKnown !== false && (sample.kind !== "message" || sample.model === null)) return;
  const config = getRunConfiguration(db, swarmId, originRun);
  const assigned = config?.effective.workers.find((worker) => worker.name === agent);
  const archived = !assigned
    ? db.sql
        .prepare("SELECT retired_model_id FROM participants WHERE swarm_id = ? AND name = ? AND retired_at IS NOT NULL")
        .get(swarmId, agent)
    : undefined;
  const expectedModel =
    assigned?.modelId ?? (typeof archived?.retired_model_id === "string" ? archived.retired_model_id : undefined);
  const unexpectedModel =
    sample.kind === "message" && expectedModel !== undefined && sample.model !== null && sample.model !== expectedModel;
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
  const { costUsd, activeTimeMs } = budgetTotals(db, swarmId, now);
  db.write(() =>
    db.sql
      .prepare(
        "INSERT OR IGNORE INTO budget_stops (swarm_id, run, reason, cost_usd, active_time_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(swarmId, run, reason, costUsd, activeTimeMs, now),
  );
}

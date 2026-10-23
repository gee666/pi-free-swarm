import type { ConfigurationChange, ConfigurationRequest, RuntimeConfigurationView } from "../runtime-configuration.js";
import { PAGE_DEFAULT_COUNT, PAGE_MAX_COUNT, WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { readBudget } from "./budget.js";
import { getRunConfiguration } from "./run-configuration.js";
import { ConfigurationConflictError, getConfigurationRevision } from "./configuration-revisions.js";
import { insertEvent } from "./events.js";
import { isRunLockFresh } from "./locks.js";
import { getSwarm } from "./swarm-queries.js";
import { int, intOrNull, text, type Row } from "./rows.js";
export { getBudgetRaises } from "./budget.js";

function changeOf(raw: unknown): ConfigurationChange {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) throw new Error("Invalid configuration change");
  if (
    raw.type === "addAgents" &&
    "count" in raw &&
    typeof raw.count === "number" &&
    Number.isSafeInteger(raw.count) &&
    raw.count > 0
  ) {
    return { type: "addAgents", count: raw.count };
  }
  if (
    (raw.type === "removeAgent" || raw.type === "retireAgent") &&
    "name" in raw &&
    typeof raw.name === "string" &&
    raw.name.trim()
  ) {
    if (raw.type === "removeAgent") return { type: "removeAgent", name: raw.name.trim() };
    if ("handoffFile" in raw && typeof raw.handoffFile === "string" && raw.handoffFile.trim()) {
      return { type: "retireAgent", name: raw.name.trim(), handoffFile: raw.handoffFile };
    }
  }
  if (raw.type === "raiseBudget") {
    const moneyUsd = "moneyUsd" in raw ? raw.moneyUsd : undefined;
    const timeSeconds = "timeSeconds" in raw ? raw.timeSeconds : undefined;
    const positive = (value: unknown) =>
      value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0);
    if (
      positive(moneyUsd) &&
      positive(timeSeconds) &&
      (typeof moneyUsd === "number" || typeof timeSeconds === "number")
    ) {
      return {
        type: "raiseBudget",
        ...(typeof moneyUsd === "number" ? { moneyUsd } : {}),
        ...(typeof timeSeconds === "number" ? { timeSeconds } : {}),
      };
    }
  }
  throw new ConfigurationConflictError("Invalid configuration change fields. Refresh and submit a valid edit.");
}

function requestOf(row: Row): ConfigurationRequest {
  const parsed: unknown = JSON.parse(text(row, "change"));
  const status = text(row, "status");
  if (status !== "pending" && status !== "applying" && status !== "applied" && status !== "rejected")
    throw new Error("Invalid stored configuration request status");
  return {
    id: int(row, "id"),
    swarmId: int(row, "swarm_id"),
    run: int(row, "run"),
    expectedRevision: int(row, "expected_revision"),
    change: changeOf(parsed),
    requestedBy: text(row, "requested_by"),
    status,
    error: typeof row.error === "string" ? row.error : null,
    createdAt: int(row, "created_at"),
    finishedAt: intOrNull(row, "finished_at"),
  };
}

function emitUpdated(db: SwarmDb, swarmId: number, now: number): void {
  const swarm = getSwarm(db, swarmId, now);
  if (swarm) insertEvent(db, swarmId, "swarm.updated", { swarm }, now);
}

export function getRuntimeConfiguration(db: SwarmDb, swarmId: number, now: number): RuntimeConfigurationView | null {
  const row = db.sql.prepare("SELECT run_count FROM swarms WHERE id = ?").get(swarmId);
  if (!row) return null;
  const run = int(row, "run_count");
  const configuration = getRunConfiguration(db, swarmId, run);
  const policy = configuration?.effective.budget;
  const requests = db.sql
    .prepare("SELECT * FROM configuration_requests WHERE swarm_id = ? ORDER BY id DESC LIMIT ?")
    .all(swarmId, PAGE_DEFAULT_COUNT)
    .map(requestOf);
  return {
    swarmId,
    run,
    revision: configuration?.revision ?? 0,
    configuration,
    requests,
    requestTotal: Number(
      db.sql.prepare("SELECT COUNT(*) AS n FROM configuration_requests WHERE swarm_id = ?").get(swarmId)?.n,
    ),
    budget: policy
      ? readBudget(
          db,
          swarmId,
          {
            budgetMoneyUsd: policy.moneyUsd ?? undefined,
            budgetTimeSeconds: policy.timeSeconds ?? undefined,
            gracefulShutdownOnBudget: policy.gracefulShutdown,
          },
          now,
        )
      : null,
  };
}

export function queueConfigurationChange(
  db: SwarmDb,
  swarmId: number,
  requestedBy: string,
  raw: ConfigurationChange,
  expectedRevision: number,
  now: number,
  expectedRun?: number,
): ConfigurationRequest {
  return db.write(({ sql }) => {
    const change = changeOf(raw);
    const swarm = sql.prepare("SELECT * FROM swarms WHERE id = ?").get(swarmId);
    if (!swarm) throw new ConfigurationConflictError(`Swarm #${swarmId} does not exist.`);
    const run = int(swarm, "run_count");
    if (expectedRun !== undefined && expectedRun !== run)
      throw new ConfigurationConflictError("The swarm run changed. Refresh configuration before submitting an edit.");
    const configuration = getRunConfiguration(db, swarmId, run);
    if (!configuration) throw new ConfigurationConflictError("No recorded configuration exists for this run.");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (configuration.revision ?? 0))
      throw new ConfigurationConflictError("Configuration changed. Refresh before submitting another edit.");
    const actor = sql
      .prepare("SELECT name FROM participants WHERE swarm_id = ? AND name = ?")
      .get(swarmId, requestedBy);
    if (!actor) throw new ConfigurationConflictError("Unknown configuration editor.");
    if (change.type !== "raiseBudget") {
      const status = text(swarm, "status");
      if (
        (status !== "starting" && status !== "running") ||
        !isRunLockFresh(
          { runnerPid: intOrNull(swarm, "runner_pid"), runnerHeartbeatAt: intOrNull(swarm, "runner_heartbeat_at") },
          now,
        )
      ) {
        throw new ConfigurationConflictError("Roster changes require the current live swarm owner.");
      }
    }
    if (change.type === "removeAgent" || change.type === "retireAgent") {
      const target = sql
        .prepare(
          "SELECT * FROM participants WHERE swarm_id = ? AND name = ? AND kind = 'agent' AND name <> ? AND retired_at IS NULL",
        )
        .get(swarmId, change.name, WATCHER_NAME);
      if (!target)
        throw new ConfigurationConflictError("Choose a current active worker, not Watcher or an archived name.");
      change.name = text(target, "name");
      if (change.type === "removeAgent") {
        const count = sql
          .prepare(
            "SELECT COUNT(*) AS n FROM participants WHERE swarm_id = ? AND kind = 'agent' AND name <> ? AND retired_at IS NULL",
          )
          .get(swarmId, WATCHER_NAME);
        if (Number(count?.n) <= 1)
          throw new ConfigurationConflictError("Keep at least one active worker. Use Stop to end the swarm.");
      } else if (text(actor, "name").toLowerCase() !== change.name.toLowerCase() || target.first_idle_at === null) {
        throw new ConfigurationConflictError("A worker can retire only itself after its first genuine idle turn.");
      }
    }
    const id = Number(
      sql
        .prepare(
          "INSERT INTO configuration_requests (swarm_id,run,expected_revision,change,requested_by,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(swarmId, run, expectedRevision, JSON.stringify(change), text(actor, "name"), now).lastInsertRowid,
    );
    const row = sql.prepare("SELECT * FROM configuration_requests WHERE id = ?").get(id);
    if (!row) throw new Error("Configuration request vanished during insertion");
    emitUpdated(db, swarmId, now);
    return requestOf(row);
  });
}

export function listPendingConfigurationRequests(db: SwarmDb, swarmId: number, run: number): ConfigurationRequest[] {
  return db.sql
    .prepare(
      "SELECT * FROM configuration_requests WHERE swarm_id = ? AND run = ? AND status = 'pending' ORDER BY id LIMIT ?",
    )
    .all(swarmId, run, PAGE_MAX_COUNT)
    .map(requestOf);
}

/** Join run cleanup; its final swarm snapshot notifies clients of these terminal statuses. */
export function rejectRunConfigurationRequests(db: SwarmDb, swarmId: number, run: number, now: number): number {
  return db.write(({ sql }) =>
    Number(
      sql
        .prepare(
          `UPDATE configuration_requests SET status = 'rejected', finished_at = ?, error = CASE status
       WHEN 'applying' THEN 'Run ended during this control. Inspect recorded configuration and possible partial effects; do not replay it automatically.'
       ELSE 'Run ended before this control started. Refresh configuration before submitting a new edit.' END
     WHERE swarm_id = ? AND run = ? AND status IN ('pending', 'applying')`,
        )
        .run(now, swarmId, run).changes,
    ),
  );
}

/** An applying request is not replayed after owner loss: its effect may already be committed. */
export function claimConfigurationRequest(
  db: SwarmDb,
  requestId: number,
  runnerPid: number,
  now: number,
): ConfigurationRequest {
  return db.write(({ sql }) => {
    const row = sql.prepare("SELECT * FROM configuration_requests WHERE id = ?").get(requestId);
    if (!row) throw new ConfigurationConflictError("Configuration request no longer exists.");
    const request = requestOf(row);
    const swarm = sql
      .prepare("SELECT run_count, runner_pid, runner_heartbeat_at, status FROM swarms WHERE id = ?")
      .get(request.swarmId);
    if (
      !swarm ||
      int(swarm, "run_count") !== request.run ||
      intOrNull(swarm, "runner_pid") !== runnerPid ||
      !["starting", "running"].includes(text(swarm, "status")) ||
      !isRunLockFresh({ runnerPid, runnerHeartbeatAt: intOrNull(swarm, "runner_heartbeat_at") }, now)
    )
      throw new ConfigurationConflictError("The run owner changed. This control must not be replayed.");
    if (request.status !== "pending")
      throw new ConfigurationConflictError(
        "This control has already started; inspect its recorded result before retrying.",
      );
    if (getConfigurationRevision(db, request.swarmId, request.run) !== request.expectedRevision)
      throw new ConfigurationConflictError(
        "Configuration changed before this control started. Refresh and submit a new edit.",
      );
    sql
      .prepare("UPDATE configuration_requests SET status = 'applying', owner_pid = ? WHERE id = ?")
      .run(runnerPid, requestId);
    emitUpdated(db, request.swarmId, now);
    return { ...request, status: "applying" };
  });
}

export function finishConfigurationRequest(
  db: SwarmDb,
  requestId: number,
  status: "applied" | "rejected",
  error: string | null,
  now: number,
): ConfigurationRequest {
  return db.write(({ sql }) => {
    const row = sql.prepare("SELECT * FROM configuration_requests WHERE id = ?").get(requestId);
    if (!row) throw new ConfigurationConflictError("Configuration request no longer exists.");
    const request = requestOf(row);
    if (request.status === "applied" || request.status === "rejected") return request;
    const swarm = sql
      .prepare("SELECT run_count, runner_pid, runner_heartbeat_at FROM swarms WHERE id = ?")
      .get(request.swarmId);
    if (
      !swarm ||
      int(swarm, "run_count") !== request.run ||
      (request.status === "applying" &&
        (intOrNull(swarm, "runner_pid") !== intOrNull(row, "owner_pid") ||
          !isRunLockFresh(
            { runnerPid: intOrNull(swarm, "runner_pid"), runnerHeartbeatAt: intOrNull(swarm, "runner_heartbeat_at") },
            now,
          )))
    ) {
      throw new ConfigurationConflictError(
        "The run owner changed before this control finished. Inspect its effects; do not replay it.",
      );
    }
    if (status === "applied" && request.status === "pending" && request.change.type !== "raiseBudget")
      throw new ConfigurationConflictError("A roster control must be claimed by its live owner before completion.");
    sql
      .prepare("UPDATE configuration_requests SET status = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(status, error, now, requestId);
    emitUpdated(db, request.swarmId, now);
    return { ...request, status, error, finishedAt: now };
  });
}

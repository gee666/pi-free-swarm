import type { RunConfiguration, SavedRunConfiguration, WorkerAssignment } from "../run-configuration.js";
import type { SwarmDb } from "./db.js";

/** Explicit projection prevents credentials attached to runtime objects reaching the database/API. */
function project(config: RunConfiguration): RunConfiguration {
  return {
    version: 1,
    workers: config.workers.map(({ name, provider, modelId, thinkingLevel }) => ({
      name,
      provider,
      modelId,
      thinkingLevel,
    })),
    launch: {
      projectTrusted: config.launch.projectTrusted,
      noExtensions: config.launch.noExtensions,
      extensionArgs: [...config.launch.extensionArgs],
    },
    timing: {
      staggerSeconds: config.timing.staggerSeconds,
      idleReminderDelay: config.timing.idleReminderDelay,
      idleReminderDigestSize: config.timing.idleReminderDigestSize,
      heartbeatMs: config.timing.heartbeatMs,
      deliveryPollMs: config.timing.deliveryPollMs,
      completionCheckMs: config.timing.completionCheckMs,
      progressMs: config.timing.progressMs,
      resumeStaggerMs: config.timing.resumeStaggerMs,
      reviveBackoffMs: [...config.timing.reviveBackoffMs],
    },
    limits: { bodyMaxChars: config.limits.bodyMaxChars, maxRpcFrameBytes: config.limits.maxRpcFrameBytes },
    budget: {
      moneyUsd: config.budget.moneyUsd,
      timeSeconds: config.budget.timeSeconds,
      gracefulShutdown: config.budget.gracefulShutdown,
    },
  };
}

export function saveRunConfiguration(
  db: SwarmDb,
  swarmId: number,
  run: number,
  configuration: RunConfiguration,
  now: number,
): SavedRunConfiguration {
  return db.write(({ sql }) => {
    const effective = project(configuration);
    const previous = getRunConfiguration(db, swarmId);
    const changes = previous ? changedSections(previous.effective, effective) : [];
    sql
      .prepare(
        "INSERT INTO run_configurations (swarm_id, run, recorded_at, configuration, changes) VALUES (?, ?, ?, ?, ?)",
      )
      .run(swarmId, run, now, JSON.stringify(effective), JSON.stringify(changes));
    return { run, recordedAt: now, effective, changes };
  });
}

export function changedSections(before: RunConfiguration, after: RunConfiguration): string[] {
  const sections = ["workers", "launch", "timing", "limits", "budget"] as const;
  return sections.filter((section) => JSON.stringify(before[section]) !== JSON.stringify(after[section]));
}

/** Null is intentional for old runs: historical launch arguments cannot be inferred. */
export function getRunConfiguration(db: SwarmDb, swarmId: number, run?: number): SavedRunConfiguration | null {
  const row =
    run === undefined
      ? db.sql.prepare("SELECT * FROM run_configurations WHERE swarm_id = ? ORDER BY run DESC LIMIT 1").get(swarmId)
      : db.sql.prepare("SELECT * FROM run_configurations WHERE swarm_id = ? AND run = ?").get(swarmId, run);
  if (!row) return null;
  const value: unknown = JSON.parse(String(row.configuration));
  const changes: unknown = JSON.parse(String(row.changes));
  if (!isConfiguration(value) || !strings(changes)) throw new Error("Invalid persisted run configuration");
  return { run: Number(row.run), recordedAt: Number(row.recorded_at), effective: project(value), changes };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function worker(value: unknown): value is WorkerAssignment {
  return (
    record(value) &&
    typeof value.name === "string" &&
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    (value.thinkingLevel === null || typeof value.thinkingLevel === "string")
  );
}
function isConfiguration(value: unknown): value is RunConfiguration {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.workers) || !value.workers.every(worker))
    return false;
  const { launch, timing, limits, budget } = value;
  return (
    record(launch) &&
    typeof launch.projectTrusted === "boolean" &&
    typeof launch.noExtensions === "boolean" &&
    strings(launch.extensionArgs) &&
    record(timing) &&
    [
      "staggerSeconds",
      "idleReminderDelay",
      "idleReminderDigestSize",
      "heartbeatMs",
      "deliveryPollMs",
      "completionCheckMs",
      "progressMs",
      "resumeStaggerMs",
    ].every((key) => finite(timing[key])) &&
    Array.isArray(timing.reviveBackoffMs) &&
    timing.reviveBackoffMs.every(finite) &&
    record(limits) &&
    finite(limits.bodyMaxChars) &&
    finite(limits.maxRpcFrameBytes) &&
    record(budget) &&
    (budget.moneyUsd === null || finite(budget.moneyUsd)) &&
    (budget.timeSeconds === null || finite(budget.timeSeconds)) &&
    typeof budget.gracefulShutdown === "boolean"
  );
}

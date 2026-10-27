import path from "node:path";
import { RESERVED_NAMES, WATCHER_NAME } from "../constants.js";
import type { RunConfiguration, WorkerAssignment } from "../run-configuration.js";
import { agentSessionFile, type SwarmDb } from "./db.js";
import { appendConfigurationRevision, ConfigurationConflictError } from "./configuration-revisions.js";
import { getRunConfiguration } from "./run-configuration.js";
import { getParticipant, getSwarm } from "./swarm-queries.js";
import { insertEvent } from "./events.js";
import { isRunLockFresh } from "./locks.js";
import { text } from "./rows.js";

export function activeWorkerNames(db: SwarmDb, swarmId: number): string[] {
  return db.sql
    .prepare(
      "SELECT name FROM participants WHERE swarm_id = ? AND kind = 'agent' AND name <> ? AND retired_at IS NULL ORDER BY launch_order",
    )
    .all(swarmId, WATCHER_NAME)
    .map((row) => text(row, "name"));
}

export function getActiveAssignments(db: SwarmDb, swarmId: number): WorkerAssignment[] {
  const names = new Set(activeWorkerNames(db, swarmId).map((name) => name.toLowerCase()));
  return (getRunConfiguration(db, swarmId)?.effective.workers ?? []).filter((worker) =>
    names.has(worker.name.toLowerCase()),
  );
}

/** Apply replacement atomically so observers never see an intermediate roster. */
export function applyRosterConfiguration(
  db: SwarmDb,
  swarmId: number,
  run: number,
  configuration: RunConfiguration,
  expectedRevision: number,
  now: number,
  runnerPid: number = process.pid,
) {
  return db.write(({ sql }) => {
    const owner = sql
      .prepare("SELECT runner_pid, runner_heartbeat_at, status, run_count FROM swarms WHERE id = ?")
      .get(swarmId);
    if (
      !owner ||
      Number(owner.run_count) !== run ||
      Number(owner.runner_pid) !== runnerPid ||
      !["starting", "running"].includes(String(owner.status)) ||
      !isRunLockFresh({ runnerPid, runnerHeartbeatAt: Number(owner.runner_heartbeat_at) }, now)
    )
      throw new ConfigurationConflictError("Only the current live run owner can apply roster changes.");
    const next = configuration.workers;
    if (next.length === 0)
      throw new ConfigurationConflictError("Keep at least one active worker. Use Stop to end the swarm.");
    const names = next.map((worker) => worker.name.toLowerCase());
    if (
      new Set(names).size !== names.length ||
      next.some(
        (worker) =>
          !/^[A-Za-z]+$/.test(worker.name) ||
          RESERVED_NAMES.some((name) => name.toLowerCase() === worker.name.toLowerCase()),
      )
    ) {
      throw new ConfigurationConflictError(
        "Worker names must be fresh, nonempty and distinct from reserved participants.",
      );
    }
    const current = getActiveAssignments(db, swarmId);
    const active = activeWorkerNames(db, swarmId);
    const all = sql.prepare("SELECT name, retired_at FROM participants WHERE swarm_id = ?").all(swarmId);
    for (const worker of next) {
      const existing = all.find((row) => text(row, "name").toLowerCase() === worker.name.toLowerCase());
      if (existing && existing.retired_at !== null)
        throw new ConfigurationConflictError(`Retired identity ${worker.name} cannot be reused. Choose a fresh name.`);
      if (existing && text(existing, "name") !== worker.name)
        throw new ConfigurationConflictError("Retained worker names keep their canonical spelling.");
      const retained = current.find((slot) => slot.name.toLowerCase() === worker.name.toLowerCase());
      if (
        retained &&
        (retained.provider !== worker.provider ||
          retained.modelId !== worker.modelId ||
          retained.thinkingLevel !== worker.thinkingLevel)
      ) {
        throw new ConfigurationConflictError(
          `Existing worker ${worker.name} keeps its recorded model and thinking assignment.`,
        );
      }
    }
    const removed = active.filter((name) => !names.includes(name.toLowerCase()));
    const added = next.filter(
      (worker) => !all.some((row) => text(row, "name").toLowerCase() === worker.name.toLowerCase()),
    );
    const saved = appendConfigurationRevision(db, swarmId, run, configuration, expectedRevision, now);
    for (const name of removed) {
      sql
        .prepare(
          "UPDATE agent_runs SET ended_at = ?, reason = 'stopped' WHERE swarm_id = ? AND agent = ? AND ended_at IS NULL",
        )
        .run(now, swarmId, name);
      const assignment = current.find((worker) => worker.name === name);
      sql
        .prepare(
          "UPDATE participants SET retired_at = ?, retired_provider = ?, retired_model_id = ?, retired_thinking_level = ?, status = 'stopped', activity = NULL WHERE swarm_id = ? AND name = ? AND retired_at IS NULL",
        )
        .run(
          now,
          assignment?.provider ?? null,
          assignment?.modelId ?? null,
          assignment?.thinkingLevel ?? null,
          swarmId,
          name,
        );
    }
    let order =
      Number(
        sql
          .prepare(
            "SELECT COALESCE(MAX(launch_order), -1) AS n FROM participants WHERE swarm_id = ? AND kind = 'agent'",
          )
          .get(swarmId)?.n,
      ) + 1;
    for (const worker of added) {
      const session = path.relative(db.dataDir, agentSessionFile(db.dataDir, swarmId, worker.name));
      sql
        .prepare(
          "INSERT INTO participants (swarm_id,name,kind,status,session_file,launch_order) VALUES (?,?,'agent','pending',?,?)",
        )
        .run(swarmId, worker.name, session, order++);
    }
    sql.prepare("UPDATE swarms SET agent_amount = ? WHERE id = ?").run(next.length, swarmId);
    for (const name of [...removed, ...added.map((worker) => worker.name)]) {
      const participant = getParticipant(db, swarmId, name);
      if (participant) insertEvent(db, swarmId, "participant.updated", { participant }, now);
    }
    const swarm = getSwarm(db, swarmId, now);
    if (swarm) insertEvent(db, swarmId, "swarm.updated", { swarm }, now);
    return saved;
  });
}

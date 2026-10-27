// Swarm lifecycle writes: create, resume, running, end, and the sweep of runs whose runner vanished.
import { ensureWatcher } from "./watcher.js";
import path from "node:path";
import type { SwarmListItem } from "../api-types.js";
import { MAIN_NAME, RESERVED_NAMES, SYSTEM_NAME, USER_NAME } from "../constants.js";
import { charCount, TITLE_MAX } from "../limits.js";
import { agentSessionFile, type SwarmDb } from "../store/db.js";
import { claimRunLock, heartbeatRunLock, isPidAlive, isRunLockFresh, type PidAlive } from "../store/locks.js";
import { count, int, intOrNull, swarmStatusOf, text } from "../store/rows.js";
import { getSwarm } from "../store/swarm-queries.js";
import { rejectRunConfigurationRequests } from "../store/runtime-configuration.js";
import { emitParticipantUpdated, emitSwarmUpdated } from "./emit.js";
import { BrokerError } from "./errors.js";
import { requireAcceptanceCriteria } from "./validate.js";
import { cleanupRun, type RunEndStatus } from "./run-cleanup.js";
import { interruptedActiveUntil } from "./interrupted-time.js";
import { ensureWorkGraphInitialized } from "./project.js";
import { commitWorkRunCompletion } from "./work-run-completion.js";

export type { RunEndStatus } from "./run-cleanup.js";

function requireSwarmName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new BrokerError("validation", "swarm_name is empty.", "swarm_name");
  const length = charCount(name);
  if (length > TITLE_MAX) {
    throw new BrokerError("validation", `swarm_name too long: ${length}/${TITLE_MAX} characters.`, "swarm_name");
  }
  return name;
}

function swarmOrThrow(db: SwarmDb, swarmId: number, now: number): SwarmListItem {
  const swarm = getSwarm(db, swarmId, now);
  if (swarm === null) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
  return swarm;
}

/** Status `starting`, run 1, run lock held by `runnerPid`, participants User/Main/System + agents. */
export function createSwarm(
  db: SwarmDb,
  input: {
    name: string;
    taskPrompt: string;
    acceptanceCriteria: readonly string[];
    agentNames: readonly string[];
    runnerPid: number;
    now: number;
  },
): SwarmListItem {
  const { runnerPid, now } = input;
  const acceptanceCriteria = requireAcceptanceCriteria(input.acceptanceCriteria);
  if (
    input.agentNames.some((name) => RESERVED_NAMES.some((reserved) => reserved.toLowerCase() === name.toLowerCase()))
  ) {
    throw new BrokerError("validation", "Agent names cannot use reserved participant names.");
  }
  const name = requireSwarmName(input.name);
  const taskPrompt = input.taskPrompt.trim();
  if (taskPrompt.length === 0) throw new BrokerError("validation", "task_prompt is empty.", "task_prompt");
  return db.write(() => {
    const swarmId = count(
      db.sql
        .prepare(
          `INSERT INTO swarms (name, task_prompt, agent_amount, status, runner_pid, runner_heartbeat_at,
             created_at, started_at, run_count)
           VALUES (?, ?, ?, 'starting', ?, ?, ?, ?, 1)`,
        )
        .run(name, taskPrompt, input.agentNames.length, runnerPid, now, now, now).lastInsertRowid,
    );
    db.sql.prepare("INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (?, 1, ?)").run(swarmId, now);
    const reserved = db.sql.prepare("INSERT INTO participants (swarm_id, name, kind) VALUES (?, ?, ?)");
    reserved.run(swarmId, USER_NAME, "user");
    reserved.run(swarmId, MAIN_NAME, "main");
    reserved.run(swarmId, SYSTEM_NAME, "system");
    const agent = db.sql.prepare(
      `INSERT INTO participants (swarm_id, name, kind, status, session_file, launch_order)
       VALUES (?, ?, 'agent', 'pending', ?, ?)`,
    );
    input.agentNames.forEach((agentName, order) => {
      const sessionFile = path.relative(db.dataDir, agentSessionFile(db.dataDir, swarmId, agentName));
      agent.run(swarmId, agentName, sessionFile, order);
    });
    ensureWatcher(db, swarmId);
    ensureWorkGraphInitialized(db, swarmId, now, acceptanceCriteria);
    emitSwarmUpdated(db, swarmId, now);
    return swarmOrThrow(db, swarmId, now);
  });
}

/**
 * Claims the run lock for a new run. A live-looking swarm with a stale lock is first cleaned up as
 * `interrupted`; a fresh lock (another process, or this one) is refused.
 */
export function beginResume(
  db: SwarmDb,
  swarmId: number,
  runnerPid: number,
  now: number,
): { swarm: SwarmListItem; run: number } {
  return db.write(() => {
    const row = db.sql.prepare("SELECT * FROM swarms WHERE id = ?").get(swarmId);
    if (row === undefined) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
    const lock = { runnerPid: intOrNull(row, "runner_pid"), runnerHeartbeatAt: intOrNull(row, "runner_heartbeat_at") };
    if (lock.runnerPid !== null && isRunLockFresh(lock, now)) {
      const message =
        lock.runnerPid === runnerPid
          ? `Swarm #${swarmId} is already running in this pi process.`
          : `Swarm #${swarmId} is running in another pi process (pid ${lock.runnerPid}).`;
      throw new BrokerError("swarm_running", message);
    }
    const status = swarmStatusOf(row);
    if (status === "starting" || status === "running")
      cleanupRun(db, swarmId, "interrupted", now, interruptedActiveUntil(db, swarmId, now));
    const claim = claimRunLock(db, swarmId, runnerPid, now);
    if (!claim.ok) {
      throw new BrokerError(
        "swarm_running",
        `Swarm #${swarmId} is running in another pi process (pid ${claim.holderPid}).`,
      );
    }
    rejectRunConfigurationRequests(db, swarmId, int(row, "run_count"), now);
    ensureWatcher(db, swarmId);
    ensureWorkGraphInitialized(db, swarmId, now);
    const run = int(row, "run_count") + 1;
    db.sql
      .prepare(
        `UPDATE swarms SET run_count = ?, status = 'starting',
           started_at = ?, finished_at = NULL, outcome = NULL
         WHERE id = ?`,
      )
      .run(run, now, swarmId);
    db.sql.prepare("INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (?, ?, ?)").run(swarmId, run, now);
    const agents = db.sql
      .prepare(
        "SELECT name FROM participants WHERE swarm_id = ? AND kind = 'agent' AND retired_at IS NULL AND status <> 'pending' ORDER BY launch_order",
      )
      .all(swarmId)
      .map((agent) => text(agent, "name"));
    db.sql
      .prepare(
        "UPDATE participants SET status = 'pending', activity = NULL WHERE swarm_id = ? AND kind = 'agent' AND retired_at IS NULL",
      )
      .run(swarmId);
    for (const name of agents) emitParticipantUpdated(db, swarmId, name, now);
    emitSwarmUpdated(db, swarmId, now);
    return { swarm: swarmOrThrow(db, swarmId, now), run };
  });
}

/** `starting → running` once the last agent of the stagger has been launched. */
export function markSwarmRunning(
  db: SwarmDb,
  swarmId: number,
  runnerPid: number,
  now: number,
  expectedRun?: number,
): void {
  db.write(() => {
    const changed = db.sql
      .prepare(
        `UPDATE swarms SET status = 'running'
         WHERE id = ? AND runner_pid = ? AND status = 'starting' AND (? IS NULL OR run_count = ?)`,
      )
      .run(swarmId, runnerPid, expectedRun ?? null, expectedRun ?? null);
    if (count(changed.changes) > 0) emitSwarmUpdated(db, swarmId, now);
  });
}

/** Returns false without writes if the runner or expected run no longer owns the swarm. */
export function endRun(
  db: SwarmDb,
  swarmId: number,
  runnerPid: number,
  end: RunEndStatus,
  now: number,
  expectedRun?: number,
): boolean {
  return db.write(() => {
    const row = db.sql.prepare("SELECT runner_pid, run_count FROM swarms WHERE id = ?").get(swarmId);
    if (row === undefined) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
    if (intOrNull(row, "runner_pid") !== runnerPid) return false;
    if (expectedRun !== undefined && int(row, "run_count") !== expectedRun) return false;
    if (end === "finished" && !commitWorkRunCompletion(db, swarmId, now)) return false;
    cleanupRun(db, swarmId, end, now);
    return true;
  });
}

/** Ends every live-looking run whose lock went stale as `interrupted`; returns their ids. */
export function sweepStaleRuns(
  db: SwarmDb,
  now: number,
  alive: PidAlive = isPidAlive,
  isOwnedActiveRun?: (swarmId: number, runnerPid: number) => boolean,
): number[] {
  return db.write(() => {
    const stale = db.sql
      .prepare("SELECT id, runner_pid, runner_heartbeat_at FROM swarms WHERE status IN ('starting', 'running')")
      .all()
      .filter((row) => {
        const swarmId = int(row, "id");
        const runnerPid = intOrNull(row, "runner_pid");
        // A suspended event loop may resume with its sweep timer ahead of its heartbeat timer.
        // Only runtime-confirmed ownership protects a run; abandoned same-pid rows still expire.
        if (runnerPid === process.pid && isOwnedActiveRun?.(swarmId, runnerPid)) {
          heartbeatRunLock(db, swarmId, runnerPid, now);
          return false;
        }
        return !isRunLockFresh({ runnerPid, runnerHeartbeatAt: intOrNull(row, "runner_heartbeat_at") }, now, alive);
      })
      .map((row) => int(row, "id"));
    for (const swarmId of stale) cleanupRun(db, swarmId, "interrupted", now, interruptedActiveUntil(db, swarmId, now));
    return stale;
  });
}

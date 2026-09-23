// Cross-process ownership: the per-swarm run lock and the single server_host row. Both are a pid plus a
// heartbeat; a lock is stale when the heartbeat is old or the pid is gone.
import { RUN_LOCK_STALE_MS, SERVER_HOST_STALE_MS } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { count, int, intOrNull } from "./rows.js";

export type PidAlive = (pid: number) => boolean;

/** Signal 0 only checks existence; EPERM means the process exists but belongs to someone else. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

// ── Run lock (swarms.runner_pid / runner_heartbeat_at) ───────────────────────

export interface RunLock {
  runnerPid: number | null;
  runnerHeartbeatAt: number | null;
}

export function isRunLockFresh(lock: RunLock, now: number, alive: PidAlive = isPidAlive): boolean {
  return (
    lock.runnerPid !== null &&
    lock.runnerHeartbeatAt !== null &&
    now - lock.runnerHeartbeatAt <= RUN_LOCK_STALE_MS &&
    alive(lock.runnerPid)
  );
}

export function claimRunLock(
  db: SwarmDb,
  swarmId: number,
  pid: number,
  now: number,
  alive: PidAlive = isPidAlive,
): { ok: true } | { ok: false; holderPid: number } {
  return db.write(() => {
    const row = db.sql.prepare("SELECT runner_pid, runner_heartbeat_at FROM swarms WHERE id = ?").get(swarmId);
    if (row === undefined) throw new Error(`Swarm #${swarmId} not found.`);
    const lock: RunLock = {
      runnerPid: intOrNull(row, "runner_pid"),
      runnerHeartbeatAt: intOrNull(row, "runner_heartbeat_at"),
    };
    if (lock.runnerPid !== null && lock.runnerPid !== pid && isRunLockFresh(lock, now, alive)) {
      return { ok: false, holderPid: lock.runnerPid };
    }
    db.sql.prepare("UPDATE swarms SET runner_pid = ?, runner_heartbeat_at = ? WHERE id = ?").run(pid, now, swarmId);
    return { ok: true };
  });
}

/** `false` = the lock is no longer ours (released or taken over after going stale). */
export function heartbeatRunLock(db: SwarmDb, swarmId: number, pid: number, now: number): boolean {
  const result = db.sql
    .prepare("UPDATE swarms SET runner_heartbeat_at = ? WHERE id = ? AND runner_pid = ?")
    .run(now, swarmId, pid);
  return count(result.changes) > 0;
}

export function releaseRunLock(db: SwarmDb, swarmId: number, pid: number): void {
  db.sql
    .prepare("UPDATE swarms SET runner_pid = NULL, runner_heartbeat_at = NULL WHERE id = ? AND runner_pid = ?")
    .run(swarmId, pid);
}

// ── Server host (single row, id = 1) ─────────────────────────────────────────

export interface ServerHostRow {
  pid: number;
  port: number;
  heartbeatAt: number;
}

function isHostFresh(host: ServerHostRow, now: number, alive: PidAlive): boolean {
  return host.heartbeatAt > 0 && now - host.heartbeatAt <= SERVER_HOST_STALE_MS && alive(host.pid);
}

function selectHost(db: SwarmDb): ServerHostRow | null {
  const row = db.sql.prepare("SELECT pid, port, heartbeat_at FROM server_host WHERE id = 1").get();
  return row === undefined
    ? null
    : { pid: int(row, "pid"), port: int(row, "port"), heartbeatAt: int(row, "heartbeat_at") };
}

/** A fresh claim has `port = 0` until `setServerHostPort`; `previousPort` lets the new host keep the URL. */
export function claimServerHost(
  db: SwarmDb,
  pid: number,
  now: number,
  alive: PidAlive = isPidAlive,
): { claimed: true; previousPort: number | null } | { claimed: false; holder: ServerHostRow } {
  return db.write(() => {
    const host = selectHost(db);
    if (host === null) {
      db.sql.prepare("INSERT INTO server_host (id, pid, port, heartbeat_at) VALUES (1, ?, 0, ?)").run(pid, now);
      return { claimed: true, previousPort: null };
    }
    const previousPort = host.port > 0 ? host.port : null;
    if (host.pid === pid) {
      db.sql.prepare("UPDATE server_host SET heartbeat_at = ? WHERE id = 1").run(now);
      return { claimed: true, previousPort };
    }
    if (isHostFresh(host, now, alive)) return { claimed: false, holder: host };
    db.sql.prepare("UPDATE server_host SET pid = ?, port = 0, heartbeat_at = ? WHERE id = 1").run(pid, now);
    return { claimed: true, previousPort };
  });
}

export function setServerHostPort(db: SwarmDb, pid: number, port: number): void {
  db.sql.prepare("UPDATE server_host SET port = ? WHERE id = 1 AND pid = ?").run(port, pid);
}

/** `false` = another process took the row over. */
export function heartbeatServerHost(db: SwarmDb, pid: number, now: number): boolean {
  const result = db.sql.prepare("UPDATE server_host SET heartbeat_at = ? WHERE id = 1 AND pid = ?").run(now, pid);
  return count(result.changes) > 0;
}

/** Keeps the row (and its port) so the next host takes over on its next poll with the same URL. */
export function releaseServerHost(db: SwarmDb, pid: number): void {
  db.sql.prepare("UPDATE server_host SET heartbeat_at = 0 WHERE id = 1 AND pid = ?").run(pid);
}

/** The live host with a bound port, else `null`. */
export function readServerHost(db: SwarmDb, now: number, alive: PidAlive = isPidAlive): ServerHostRow | null {
  const host = selectHost(db);
  return host !== null && host.port > 0 && isHostFresh(host, now, alive) ? host : null;
}

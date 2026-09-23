// A fresh swarm.db in its own temp project folder per test, so test files run in parallel.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SwarmListItem } from "../../src/api-types.js";
import { createSwarm } from "../../src/broker/swarms.js";
import { openSwarmDb, swarmDbPath, type SwarmDb } from "../../src/store/db.js";

export interface TempDb {
  /** Project folder; the DB is at `<cwd>/.pi/swarm/swarm.db`. */
  cwd: string;
  db: SwarmDb;
  cleanup(): void;
}

export function createTempDb(): TempDb {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-"));
  const db = openSwarmDb(swarmDbPath(cwd), { create: true });
  return {
    cwd,
    db,
    cleanup() {
      db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export const T0 = 1_700_000_000_000;

/** A live swarm run by this process, created at `T0`. */
export function seedSwarm(
  db: SwarmDb,
  options: { agents?: readonly string[]; name?: string; now?: number; runnerPid?: number } = {},
): SwarmListItem {
  return createSwarm(db, {
    name: options.name ?? "demo",
    taskPrompt: "Build the thing. Requirements: docs/req.md",
    agentNames: options.agents ?? ["Maria", "John", "Liam"],
    runnerPid: options.runnerPid ?? process.pid,
    now: options.now ?? T0,
  });
}

/** Types of all outbox rows, oldest first. */
export function eventTypes(db: SwarmDb): string[] {
  return db.sql
    .prepare("SELECT type FROM events ORDER BY id")
    .all()
    .map((row) => String(row.type));
}

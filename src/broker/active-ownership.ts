import type { SwarmDb } from "../store/db.js";

const owners = new Map<string, Map<number, number>>();

/** Process-local ownership, not a substitute for checking another process's lock. */
export function ownsActiveRun(db: SwarmDb, swarmId: number, runnerPid: number): boolean {
  return owners.get(db.path)?.get(swarmId) === runnerPid;
}

export function registerActiveRun(db: SwarmDb, swarmId: number, runnerPid: number): () => void {
  let runs = owners.get(db.path);
  if (!runs) owners.set(db.path, (runs = new Map()));
  runs.set(swarmId, runnerPid);
  return () => {
    runs.delete(swarmId);
    if (runs.size === 0) owners.delete(db.path);
  };
}

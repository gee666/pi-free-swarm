import type { SwarmDb } from "../store/db.js";
import { int, intOrNull, text } from "../store/rows.js";

export type RunOwnership = "owned" | "closed" | "lost";

/** A process-local lifecycle flag cannot fence another process taking over the database run. */
export function readRunOwnership(db: SwarmDb, swarmId: number, run: number, runnerPid?: number): RunOwnership {
  const row = db.sql
    .prepare(
      `SELECT s.run_count, s.runner_pid, s.status, a.closed_run
    FROM swarms s JOIN acceptance a ON a.swarm_id = s.id WHERE s.id = ?`,
    )
    .get(swarmId);
  if (
    !row ||
    int(row, "run_count") !== run ||
    intOrNull(row, "runner_pid") === null ||
    (runnerPid !== undefined && intOrNull(row, "runner_pid") !== runnerPid) ||
    !["starting", "running"].includes(text(row, "status"))
  )
    return "lost";
  return intOrNull(row, "closed_run") === run ? "closed" : "owned";
}

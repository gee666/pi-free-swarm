import type { SwarmDb } from "../store/db.js";
import { int, intOrNull, text } from "../store/rows.js";

export type RunOwnership = "owned" | "closed" | "lost";

/** A process-local lifecycle flag cannot fence another process taking over the database run. */
export function readRunOwnership(db: SwarmDb, swarmId: number, run: number, runnerPid?: number): RunOwnership {
  const row = db.sql
    .prepare(`SELECT run_count, runner_pid, status, admission_closed_run AS closed_run FROM swarms WHERE id = ?`)
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

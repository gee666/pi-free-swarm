import type { SwarmDb } from "../store/db.js";
import { int } from "../store/rows.js";

export function closeRunAdmission(db: SwarmDb, swarmId: number, run?: number, runnerPid?: number): boolean {
  return db.write(() => {
    const row = db.sql.prepare("SELECT run_count, runner_pid FROM swarms WHERE id = ?").get(swarmId);
    if (
      !row ||
      (run !== undefined && int(row, "run_count") !== run) ||
      (runnerPid !== undefined && row.runner_pid !== runnerPid)
    )
      return false;
    db.sql.prepare("UPDATE swarms SET admission_closed_run = run_count WHERE id = ?").run(swarmId);
    return true;
  });
}

// Run shutdown releases execution resources, not durable pending or unobserved communication.
import type { SwarmDb } from "../store/db.js";
import { intOrNull, text, textOrNull } from "../store/rows.js";
import { releaseRunLock } from "../store/locks.js";
import { emitParticipantUpdated, emitSwarmUpdated } from "./emit.js";
import { freezeRunAcceptance } from "./run-acceptance.js";

export type RunEndStatus = "finished" | "stopped" | "interrupted";

export function cleanupRun(db: SwarmDb, swarmId: number, end: RunEndStatus, now: number): void {
  db.write(() => {
    freezeRunAcceptance(db, swarmId);
    const before = new Map(
      db.sql
        .prepare("SELECT name, status, activity FROM participants WHERE swarm_id = ? AND kind = 'agent'")
        .all(swarmId)
        .map((row) => [text(row, "name"), `${text(row, "status")}|${textOrNull(row, "activity")}`]),
    );
    const swarm = db.sql.prepare("SELECT runner_pid FROM swarms WHERE id = ?").get(swarmId);
    const runnerPid = swarm === undefined ? null : intOrNull(swarm, "runner_pid");
    if (runnerPid !== null) releaseRunLock(db, swarmId, runnerPid);
    db.sql.prepare("UPDATE swarms SET status = ?, finished_at = ? WHERE id = ?").run(end, now, swarmId);
    db.sql
      .prepare("UPDATE swarm_runs SET ended_at = ?, end_status = ? WHERE swarm_id = ? AND ended_at IS NULL")
      .run(now, end, swarmId);
    db.sql
      .prepare("UPDATE agent_runs SET ended_at = ?, reason = 'stopped' WHERE swarm_id = ? AND ended_at IS NULL")
      .run(now, swarmId);
    db.sql
      .prepare(
        `UPDATE participants SET activity = NULL,
           status = CASE WHEN status <> 'crashed' THEN 'stopped' ELSE status END
         WHERE swarm_id = ? AND kind = 'agent'`,
      )
      .run(swarmId);
    for (const row of db.sql
      .prepare("SELECT name, status, activity FROM participants WHERE swarm_id = ? AND kind = 'agent'")
      .all(swarmId)) {
      const name = text(row, "name");
      if (before.get(name) !== `${text(row, "status")}|${textOrNull(row, "activity")}`) {
        emitParticipantUpdated(db, swarmId, name, now);
      }
    }
    emitSwarmUpdated(db, swarmId, now);
  });
}

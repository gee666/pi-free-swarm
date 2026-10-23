import type { SwarmDb } from "../store/db.js";
import { int, intOrNull } from "../store/rows.js";

/** A dead owner's discovery time is not evidence that it executed through the entire downtime. */
export function interruptedActiveUntil(db: SwarmDb, swarmId: number, discoveredAt: number): number {
  const row = db.sql
    .prepare(
      `SELECT r.run, r.started_at, s.runner_heartbeat_at
    FROM swarms s JOIN swarm_runs r ON r.swarm_id = s.id AND r.run = s.run_count WHERE s.id = ?`,
    )
    .get(swarmId);
  if (!row) throw new Error(`No current run exists for interrupted swarm #${swarmId}.`);
  const run = int(row, "run");
  const startedAt = int(row, "started_at");
  const observed = db.sql
    .prepare(
      `SELECT MAX(observed_at) AS latest FROM (
    SELECT MAX(started_at) AS observed_at FROM agent_runs WHERE swarm_id = ? AND run = ?
    UNION ALL SELECT MAX(ended_at) FROM agent_runs WHERE swarm_id = ? AND run = ?
    UNION ALL SELECT MAX(created_at) FROM usage WHERE swarm_id = ? AND run = ?
  )`,
    )
    .get(swarmId, run, swarmId, run, swarmId, run);
  const knownUntil = Math.max(
    startedAt,
    intOrNull(row, "runner_heartbeat_at") ?? startedAt,
    observed ? (intOrNull(observed, "latest") ?? startedAt) : startedAt,
  );
  return Math.max(startedAt, Math.min(discoveredAt, knownUntil));
}

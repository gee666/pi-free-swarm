import type { SwarmDb } from "./db.js";
import { text } from "./rows.js";

export function retiringWorkers(db: SwarmDb, swarmId: number): Set<string> {
  return new Set(
    db.sql
      .prepare(
        `SELECT json_extract(r.change, '$.name') AS name FROM configuration_requests r
        JOIN swarms s ON s.id = r.swarm_id
        WHERE r.swarm_id = ? AND (r.status = 'applied'
          OR (r.run = s.run_count AND r.status IN ('pending', 'applying')))
        AND json_extract(r.change, '$.type') = 'retireAgent'`,
      )
      .all(swarmId)
      .map((row) => text(row, "name")),
  );
}

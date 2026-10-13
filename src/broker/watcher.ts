import path from "node:path";
import { WATCHER_NAME } from "../constants.js";
import { agentSessionFile, type SwarmDb } from "../store/db.js";
import { requireSwarm } from "./validate.js";

export function ensureWatcher(db: SwarmDb, swarmId: number): void {
  db.write(() => {
    requireSwarm(db, swarmId);
    db.sql
      .prepare(
        `INSERT OR IGNORE INTO participants
      (swarm_id, name, kind, status, session_file, launch_order)
      VALUES (?, ?, 'agent', 'pending', ?, (SELECT COUNT(*) FROM participants WHERE swarm_id = ? AND kind = 'agent'))`,
      )
      .run(
        swarmId,
        WATCHER_NAME,
        path.relative(db.dataDir, agentSessionFile(db.dataDir, swarmId, WATCHER_NAME)),
        swarmId,
      );
  });
}

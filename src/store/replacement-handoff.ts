import path from "node:path";
import { WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { ConfigurationConflictError } from "./configuration-revisions.js";
import { text } from "./rows.js";

/** Join fresh-slot creation, so a crash before launch cannot detach the handoff from its recipient. */
export function seedReplacementHandoff(
  db: SwarmDb,
  swarmId: number,
  name: string,
  handoffFile: string,
  now: number,
): void {
  const root = path.join(db.dataDir, "handoffs", String(swarmId));
  if (path.isAbsolute(handoffFile) || !path.resolve(db.dataDir, handoffFile).startsWith(root + path.sep)) {
    throw new ConfigurationConflictError("Replacement handoffs must reference this swarm's generated handoff files.");
  }
  db.write(({ sql }) => {
    const worker = sql
      .prepare(
        "SELECT 1 FROM participants WHERE swarm_id = ? AND name = ? AND kind = 'agent' AND name <> ? AND retired_at IS NULL AND first_idle_at IS NULL",
      )
      .get(swarmId, name, WATCHER_NAME);
    if (!worker)
      throw new ConfigurationConflictError("A handoff can be seeded only for a fresh active worker before first idle.");
    sql
      .prepare("INSERT OR IGNORE INTO replacement_handoffs (swarm_id,name,handoff_file,created_at) VALUES (?,?,?,?)")
      .run(swarmId, name, handoffFile, now);
  });
}

/** First genuine idle proves the fresh kickoff settled; older mappings remain historical evidence. */
export function getPendingReplacementHandoff(db: SwarmDb, swarmId: number, name: string): string | null {
  const row = db.sql
    .prepare(
      `SELECT h.handoff_file FROM replacement_handoffs h JOIN participants p ON p.swarm_id = h.swarm_id AND p.name = h.name
     WHERE h.swarm_id = ? AND h.name = ? AND p.retired_at IS NULL AND p.first_idle_at IS NULL`,
    )
    .get(swarmId, name);
  return row ? text(row, "handoff_file") : null;
}

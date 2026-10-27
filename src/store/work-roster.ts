import { WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int, text } from "./rows.js";

export interface WorkAgent {
  name: string;
  active: boolean;
  idle: boolean;
  openTasks: number;
}
export function hasActiveWorkRun(db: SwarmDb, swarmId: number): boolean {
  const row = db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(swarmId);
  return row !== undefined && ["starting", "running"].includes(text(row, "status"));
}

export function workRoster(db: SwarmDb, swarmId: number): WorkAgent[] {
  return db.sql
    .prepare(
      `SELECT p.name,
    p.retired_at IS NULL AND p.status NOT IN ('crashed', 'stopped') AS active,
    p.status = 'idle' AS idle,
    (SELECT count(*) FROM tasks t WHERE t.swarm_id = p.swarm_id AND t.owner = p.name AND t.status <> 'accepted') AS open_tasks
    FROM participants p WHERE p.swarm_id = ? AND p.kind = 'agent' AND p.name <> ? ORDER BY p.name`,
    )
    .all(swarmId, WATCHER_NAME)
    .map((row) => ({
      name: text(row, "name"),
      active: int(row, "active") === 1,
      idle: int(row, "idle") === 1,
      openTasks: int(row, "open_tasks"),
    }));
}

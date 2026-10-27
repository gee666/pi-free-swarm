import type { WorkOutcome } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { projectOf } from "./work-rows.js";

export function getProject(db: SwarmDb, swarmId: number) {
  const row = db.sql.prepare("SELECT * FROM swarms WHERE id = ?").get(swarmId);
  return row ? projectOf(row) : null;
}
export function saveIntent(db: SwarmDb, swarmId: number, summary: string, path: string, actor: string): void {
  db.sql
    .prepare(
      "UPDATE swarms SET intent_summary = ?, intent_path = ?, intent_updated_by = ?, intent_revision = intent_revision + 1 WHERE id = ?",
    )
    .run(summary, path, actor, swarmId);
}
export function saveBriefPath(db: SwarmDb, swarmId: number, path: string): void {
  db.sql.prepare("UPDATE swarms SET brief_path = ? WHERE id = ?").run(path, swarmId);
}
export function saveWorkOutcome(db: SwarmDb, swarmId: number, outcome: WorkOutcome | null): void {
  db.sql.prepare("UPDATE swarms SET outcome = ? WHERE id = ?").run(outcome, swarmId);
}

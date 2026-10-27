import type { WorkOutcome } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { projectOf } from "./work-rows.js";

export function getProject(db: SwarmDb, swarmId: number) {
  const row = db.sql.prepare("SELECT * FROM swarms WHERE id = ?").get(swarmId);
  return row ? projectOf(row) : null;
}
export function bumpScope(db: SwarmDb, swarmId: number): void {
  db.sql.prepare("UPDATE swarms SET scope_revision = scope_revision + 1 WHERE id = ?").run(swarmId);
}
export function saveIntent(db: SwarmDb, swarmId: number, summary: string, path: string): void {
  db.sql
    .prepare(
      "UPDATE swarms SET intent_summary = ?, intent_path = ?, intent_revision = intent_revision + 1, scope_revision = scope_revision + 1 WHERE id = ?",
    )
    .run(summary, path, swarmId);
}
export function saveBriefPath(db: SwarmDb, swarmId: number, path: string): void {
  db.sql.prepare("UPDATE swarms SET brief_path = ? WHERE id = ?").run(path, swarmId);
}
export function saveScopeApproval(db: SwarmDb, swarmId: number, now: number): void {
  db.sql
    .prepare("UPDATE swarms SET scope_approved_revision = scope_revision, scope_approved_at = ? WHERE id = ?")
    .run(now, swarmId);
}
export function saveWorkOutcome(db: SwarmDb, swarmId: number, outcome: WorkOutcome | null): void {
  db.sql.prepare("UPDATE swarms SET outcome = ? WHERE id = ?").run(outcome, swarmId);
}

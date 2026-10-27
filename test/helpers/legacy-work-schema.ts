import type { SwarmDb } from "../../src/store/db.js";

// Rewind fixtures must remove additive work/search schema before replaying older migrations.
export function removeWorkSchema(db: SwarmDb): void {
  db.write(() => {
    for (const table of [
      "post_links",
      "task_events",
      "task_dependencies",
      "task_criteria",
      "criterion_votes",
      "criterion_blockers",
      "tasks",
      "criteria",
      "skills",
      "search_embeddings",
    ]) {
      db.sql.exec(`DROP TABLE ${table}`);
    }
    for (const column of [
      "brief_path",
      "intent_summary",
      "intent_path",
      "intent_revision",
      "scope_revision",
      "scope_approved_revision",
      "scope_approved_at",
      "outcome",
    ]) {
      db.sql.exec(`ALTER TABLE swarms DROP COLUMN ${column}`);
    }
  });
}

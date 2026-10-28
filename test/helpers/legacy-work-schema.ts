import { readFileSync } from "node:fs";
import type { SwarmDb } from "../../src/store/db.js";

// Rewind fixtures must remove additive work/search schema before replaying older migrations.
export function removeWorkSchema(db: SwarmDb): void {
  db.write(() => {
    db.sql.exec(
      "CREATE TABLE thread_members (thread_id INTEGER NOT NULL REFERENCES threads(id), name TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (thread_id, name)); DROP TABLE user_post_attention; ALTER TABLE posts DROP COLUMN broadcast; ALTER TABLE user_comment_attention DROP COLUMN mentioned;",
    );
    for (const table of [
      "post_links",
      "task_events",
      "task_reviews",
      "task_dependencies",
      "task_criteria",
      "criterion_events",
      "criterion_votes",
      "criterion_vote_requests",
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
      "intent_updated_by",
      "intent_revision",
      "outcome",
      "admission_closed_run",
    ]) {
      db.sql.exec(`ALTER TABLE swarms DROP COLUMN ${column}`);
    }
    const sql = (file: string) => readFileSync(new URL(`../../src/store/${file}`, import.meta.url), "utf8");
    db.sql.exec(sql("acceptance.sql"));
    db.sql.exec(sql("004-acceptance-votes.sql"));
    db.sql.exec(sql("006-wall-coverage.sql"));
    db.sql.exec(sql("016-post-claims.sql"));
    db.sql.exec(sql("017-post-contracts.sql"));
    const schema = sql("schema.sql");
    db.sql.exec(schema.slice(schema.indexOf("CREATE TABLE read_marks")));
    const messages = sql("002-communication.sql");
    db.sql.exec(messages.slice(messages.indexOf("CREATE TABLE wall_changes")));
    const roster = sql("012-runtime-configuration.sql");
    const baseline = roster.indexOf("CREATE TABLE replacement_post_baselines");
    db.sql.exec(roster.slice(baseline, roster.indexOf(";", baseline) + 1));
  });
}

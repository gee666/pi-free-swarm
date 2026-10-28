import assert from "node:assert/strict";
import { test } from "node:test";
import { openSwarmDb, SCHEMA_VERSION } from "../../src/store/db.js";
import { assessCriteria } from "../../src/broker/criterion-status.js";
import { createTempDb } from "../helpers/temp-db.js";
import { seedPerformanceFixture } from "../helpers/performance-fixture.js";

test("022 upgrades populated 021, preserves reads and uses hot-path indexes", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const { swarm } = seedPerformanceFixture(db);
  const before = assessCriteria(db, swarm.id, true);
  db.sql.exec(`DROP INDEX task_activity_by_swarm; DROP INDEX criterion_activity_by_swarm;
    DROP INDEX task_acceptance_by_hour; DROP INDEX usage_by_run; PRAGMA user_version = 21;`);
  const upgraded = openSwarmDb(db.path, { create: false });
  try {
    assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    assert.deepEqual(assessCriteria(upgraded, swarm.id, true), before);
    assert.deepEqual(upgraded.sql.prepare("PRAGMA foreign_key_check").all(), []);
    for (const [query, index] of [
      ["SELECT * FROM task_criteria WHERE criterion_id = 1", "tasks_by_criterion"],
      ["SELECT * FROM criterion_votes WHERE criterion_id = 1", "sqlite_autoindex_criterion_votes_1"],
      ["SELECT * FROM tasks WHERE swarm_id = 1 AND status = 'new'", "tasks_by_swarm"],
      ["SELECT * FROM task_events WHERE task_id = 1 ORDER BY id DESC LIMIT 1", "task_timeline"],
      ["SELECT * FROM task_events WHERE swarm_id = 1 ORDER BY created_at DESC LIMIT 20", "task_activity_by_swarm"],
      [
        "SELECT * FROM criterion_events WHERE swarm_id = 1 ORDER BY created_at DESC LIMIT 20",
        "criterion_activity_by_swarm",
      ],
      [
        "SELECT count(*) FROM task_events WHERE swarm_id = 1 AND kind = 'review_accepted' AND created_at > 1",
        "task_acceptance_by_hour",
      ],
      ["SELECT sum(cost) FROM usage WHERE swarm_id = 1 AND run = 1", "usage_by_run"],
    ]) {
      const plan = upgraded.sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
      assert.ok(
        plan.some((row) => String(row.detail).includes(index)),
        JSON.stringify(plan),
      );
    }
  } finally {
    upgraded.close();
  }
  const reopened = openSwarmDb(db.path, { create: false });
  reopened.close();
});

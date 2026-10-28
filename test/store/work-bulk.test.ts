import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCriteria, assessCriterion } from "../../src/broker/criterion-status.js";
import {
  criterionListItem,
  criterionListItems,
  taskListItem,
  taskListItems,
} from "../../src/server/work-projection.js";
import { criterionStates, taskStates } from "../../src/store/work-state.js";
import { criterionStates as legacyCriteria, taskStates as legacyTasks } from "../helpers/legacy-work-state.js";
import { seedPerformanceFixture } from "../helpers/performance-fixture.js";
import { createTempDb } from "../helpers/temp-db.js";

for (const seed of [42, 1337]) {
  test(`bulk reads match per-id reads and original SQL on random graph ${seed}`, (t) => {
    const temp = createTempDb();
    t.after(() => temp.cleanup());
    const { db } = temp;
    const { swarm } = seedPerformanceFixture(db, seed);
    for (const archived of [false, true]) {
      assert.deepEqual(criterionStates(db, swarm.id, archived), legacyCriteria(db, swarm.id, archived));
      const bulk = assessCriteria(db, swarm.id, archived);
      assert.deepEqual(
        bulk,
        bulk.map((criterion) => assessCriterion(db, swarm.id, criterion.id)),
      );
      const items = criterionListItems(db, swarm.id, archived);
      assert.deepEqual(
        items,
        items.map((criterion) => criterionListItem(db, swarm.id, criterion.id)),
      );
    }
    assert.deepEqual(taskStates(db, swarm.id), legacyTasks(db, swarm.id));
    const tasks = taskListItems(db, swarm.id);
    assert.deepEqual(
      tasks,
      tasks.map((task) => taskListItem(db, swarm.id, task.id)),
    );
  });
}

test("assessment and list query counts do not grow with the graph", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const { swarm } = seedPerformanceFixture(db);
  const prepare = db.sql.prepare.bind(db.sql);
  let queries = 0;
  t.mock.method(db.sql, "prepare", (sql: string) => {
    queries++;
    return prepare(sql);
  });
  for (const archived of [false, true]) {
    queries = 0;
    assessCriteria(db, swarm.id, archived);
    assert.equal(queries, 6);
    queries = 0;
    criterionListItems(db, swarm.id, archived);
    assert.equal(queries, 7);
  }
  queries = 0;
  taskListItems(db, swarm.id);
  assert.equal(queries, 3);
});

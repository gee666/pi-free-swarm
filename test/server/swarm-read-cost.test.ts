import assert from "node:assert/strict";
import { test } from "node:test";
import { seedPerformanceFixture } from "../helpers/performance-fixture.js";
import { getJson, startTestBoard } from "./helpers.js";

test("swarm detail does not assess the work graph", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const { swarm } = seedPerformanceFixture(db);
  const prepare = db.sql.prepare.bind(db.sql);
  const queries: string[] = [];
  t.mock.method(db.sql, "prepare", (sql: string) => {
    queries.push(sql);
    return prepare(sql);
  });
  const response = await getJson(`${board.base}/api/swarms/${swarm.id}`);
  assert.equal(response.status, 200);
  assert.ok(queries.length > 0);
  assert.ok(queries.every((sql) => !/\b(criteria|tasks|criterion_votes|task_events)\b/i.test(sql)));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardResponse } from "../../src/api-types.js";
import { systemClock } from "../../src/clock.js";
import { WORK_THROUGHPUT_HOUR_MS, WORK_THROUGHPUT_WHOLE_HOURS } from "../../src/constants.js";
import { taskListItems, criterionListItems } from "../../src/server/work-projection.js";
import { listTasks } from "../../src/store/tasks.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

const HOUR = WORK_THROUGHPUT_HOUR_MS;
test("dashboard returns 13 acceptance-event buckets and current-run metadata", async (t) => {
  const now = Math.floor(T0 / HOUR) * HOUR + HOUR / 2;
  const board = await startTestBoard({ clock: { ...systemClock, now: () => now } });
  t.after(() => board.close());
  const db = board.temp.db;
  const swarm = seedSwarm(db, { now });
  const other = seedSwarm(db, { now });
  const task = listTasks(db, swarm.id)[0];
  const otherTask = listTasks(db, other.id)[0];
  assert.ok(task);
  assert.ok(otherTask);
  const current = Math.floor(now / HOUR) * HOUR;
  const start = current - WORK_THROUGHPUT_WHOLE_HOURS * HOUR;
  const event = (at: number, kind = "review_accepted", swarmId = swarm.id, taskId = task.id) =>
    db.sql
      .prepare("INSERT INTO task_events(swarm_id,task_id,actor,kind,created_at) VALUES (?,?,'Main',?,?)")
      .run(swarmId, taskId, kind, at);
  event(start - 1);
  event(start);
  event(start + HOUR - 1);
  event(start + HOUR);
  event(current - 1);
  event(current);
  event(now);
  event(now + 1);
  event(current, "changes_requested");
  event(current, "review_accepted", other.id, otherTask.id);
  for (const [run, cost] of [
    [1, 12.5],
    [2, 3.25],
  ]) {
    db.sql
      .prepare(
        `INSERT INTO usage(swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,created_at)
      VALUES (?,'Maria',?,'message',0,0,0,0,?,?)`,
      )
      .run(swarm.id, run, cost, now);
  }
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(swarm.id);
  const response = await getJson<DashboardResponse>(`${board.base}/api/swarms/${swarm.id}/dashboard`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.throughput,
    Array.from({ length: 13 }, (_, index) => ({
      hourStart: start + index * HOUR,
      accepted: index === 0 || index === 12 ? 2 : index === 1 || index === 11 ? 1 : 0,
    })),
  );
  assert.deepEqual(response.body.run, { number: 2, agentCount: swarm.agentAmount, startedAt: now, costUsd: 3.25 });
  const tasks = taskListItems(db, swarm.id);
  const criteria = criterionListItems(db, swarm.id);
  assert.equal(response.body.counts.waiting, tasks.filter((task) => task.waiting).length);
  assert.equal(response.body.counts.runnable, tasks.filter((task) => task.runnable).length);
  assert.equal(
    response.body.counts.needVotes,
    criteria.filter((item) => item.status !== "unlinked" && item.voteProgress.current < item.voteProgress.required)
      .length,
  );
});

test("empty throughput is zero-filled and run cost defaults to zero", async (t) => {
  const board = await startTestBoard({ clock: { ...systemClock, now: () => T0 } });
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const { body } = await getJson<DashboardResponse>(`${board.base}/api/swarms/${swarm.id}/dashboard`);
  assert.equal(body.throughput.length, 13);
  assert.ok(body.throughput.every((bucket) => bucket.accepted === 0));
  assert.equal(body.run.costUsd, 0);
});

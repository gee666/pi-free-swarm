import assert from "node:assert/strict";
import { test } from "node:test";
import { claimTask } from "../../src/broker/task-ownership.js";
import { reopenTask } from "../../src/broker/task-transitions.js";
import { beginTaskReview } from "../../src/broker/task-review.js";
import { finishReview } from "../helpers/task-review.js";
import { editTask } from "../../src/broker/tasks.js";
import { editCriterion } from "../../src/broker/criteria.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { ownWorkQueue } from "../../src/broker/work-queries.js";
import { workReminder } from "../../src/broker/work-reminder.js";
import { getTask } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";

function requests(f: ReturnType<typeof workFixture>) {
  return f.db.sql
    .prepare(
      `SELECT m.body, r.name FROM messages m JOIN message_recipients r ON r.message_id = m.id
     WHERE m.sender = 'System' AND m.body LIKE 'Criterion #%needs %vote.%' ORDER BY m.id`,
    )
    .all();
}

test("vote requests wait for all tasks accepted and persist once per voter and links signature", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task();
  claimTask(f.db, { ...f.input(), id: first.id });
  claimTask(f.db, { ...f.input("Ben"), id: second.id });
  assert.deepEqual(requests(f), []);
  f.accept(first.id);
  assert.deepEqual(requests(f), []);
  f.accept(second.id, "Ben");
  assert.deepEqual(
    requests(f).map((message) => message.name),
    ["Ann", "Ben", "Cam"],
  );
  assert.ok(requests(f).every((message) => String(message.body).includes("All linked tasks are accepted")));
  editCriterion(f.db, { ...f.input(), id: f.criterion.id, expectedRevision: 1, fields: { title: "Clarified" } });
  reopenTask(f.db, { ...f.input(), id: first.id, reason: "Regression" });
  beginTaskReview(f.db, { ...f.input(), id: first.id, context: "Fixed" });
  finishReview(f.db, { ...f.input("Cam"), id: first.id, verdict: "accept", reason: "Checked again" });
  assert.equal(requests(f).length, 3, "criterion edits and reacceptance do not repeat the same links signature");
  const current = getTask(f.db, f.swarmId, first.id);
  assert.ok(current);
  editTask(f.db, { ...f.input(), id: first.id, expectedRevision: current.revision, fields: { body: "Broader scope" } });
  assert.equal(requests(f).length, 3, "content edits do not push requests");
  reopenTask(f.db, { ...f.input(), id: first.id, reason: "Verify new scope" });
  beginTaskReview(f.db, { ...f.input(), id: first.id, context: "Checked new scope" });
  finishReview(f.db, { ...f.input("Cam"), id: first.id, verdict: "accept", reason: "Verified" });
  assert.equal(requests(f).length, 6, "accepting a new links signature requests votes again");
  assert.match(
    workReminder(f.db, f.swarmId, "Ann", f.input().now),
    /Do the linked tasks, when done, fully satisfy this criterion\?/,
  );
});

test("current gap and covered votes need no acceptance requests", (t) => {
  const f = workFixture(t);
  const task = f.task();
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "gap",
      reason: "Missing accessibility verification",
    });
  f.accept(task.id);
  assert.deepEqual(requests(f), []);
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "covered",
      reason: "All verification is included",
    });
  reopenTask(f.db, { ...f.input(), id: task.id, reason: "Regression" });
  assert.deepEqual(requests(f), []);
});

test("content invalidation leaves stale votes in the own queue without a push", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "covered",
      reason: "Coverage agreed",
    });
  editTask(f.db, { ...f.input(), id: task.id, expectedRevision: task.revision, fields: { body: "New scope" } });
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM messages").get()?.n, 0);
  assert.ok(ownWorkQueue(f.db, f.swarmId, "Ann").criteria.some((criterion) => criterion.id === f.criterion.id));
  assert.match(
    workReminder(f.db, f.swarmId, "Ann", f.input().now),
    new RegExp(`Coverage votes needed:.*#${f.criterion.id}`),
  );
});

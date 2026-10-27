import assert from "node:assert/strict";
import { test } from "node:test";
import { claimTask } from "../../src/broker/task-ownership.js";
import { reopenTask, requestTaskReview, reviewTask, startTask } from "../../src/broker/task-transitions.js";
import { editTask } from "../../src/broker/tasks.js";
import { voteCriterion } from "../../src/broker/votes.js";
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

test("vote-needed waits for staffed coverage, sends once per content state, and reminds on acceptance", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task();
  claimTask(f.db, { ...f.input(), id: first.id });
  assert.deepEqual(requests(f), []);
  claimTask(f.db, { ...f.input("Ben"), id: second.id });
  assert.deepEqual(
    requests(f).map((message) => message.name),
    ["Ann", "Ben", "Cam"],
  );
  assert.ok(requests(f).every((message) => String(message.body).includes("Coverage is staffed")));
  startTask(f.db, { ...f.input(), id: first.id });
  requestTaskReview(f.db, { ...f.input(), id: first.id, evidence: "Tests pass" });
  assert.equal(requests(f).length, 3);
  reviewTask(f.db, { ...f.input("Ben"), id: first.id, verdict: "accept", reason: "Checked" });
  assert.equal(requests(f).length, 3);
  f.accept(second.id, "Ben", "Cam");
  assert.equal(requests(f).length, 6);
  assert.ok(
    requests(f)
      .slice(3)
      .every((message) => String(message.body).includes("All linked tasks are accepted")),
  );
  reopenTask(f.db, { ...f.input(), id: first.id, reason: "Regression" });
  requestTaskReview(f.db, { ...f.input(), id: first.id, evidence: "Fixed" });
  reviewTask(f.db, { ...f.input("Cam"), id: first.id, verdict: "accept", reason: "Checked again" });
  assert.equal(requests(f).length, 6, "same content state is not requested repeatedly");
  const current = getTask(f.db, f.swarmId, first.id);
  assert.ok(current);
  editTask(f.db, { ...f.input(), id: first.id, expectedRevision: current.revision, fields: { body: "Broader scope" } });
  assert.equal(requests(f).length, 9, "content changes request coverage again");
  const reminder = workReminder(f.db, f.swarmId, "Ann", f.input().now);
  assert.match(reminder, /Do the linked tasks, when done, fully satisfy this criterion\?/);
  assert.match(reminder, /covered, gap/);
});

test("current gap and covered votes need no requests or acceptance reminders", (t) => {
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
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM messages WHERE body LIKE '%is stale%'").get()?.n, 0);
});

test("content invalidation coalesces stale-vote and vote-needed notices per recipient", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "covered",
      reason: "Coverage agreed",
    });
  const before = Number(f.db.sql.prepare("SELECT MAX(id) AS id FROM messages").get()?.id);
  editTask(f.db, { ...f.input(), id: task.id, expectedRevision: task.revision, fields: { body: "New scope" } });
  const messages = f.db.sql
    .prepare(
      `SELECT m.body, r.name FROM messages m JOIN message_recipients r ON r.message_id = m.id
    WHERE m.id > ? ORDER BY m.id`,
    )
    .all(before);
  assert.deepEqual(
    messages.map((message) => message.name),
    ["Ann", "Ben"],
  );
  assert.ok(messages.every((message) => String(message.body).includes("is stale")));
});

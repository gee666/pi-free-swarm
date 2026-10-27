import assert from "node:assert/strict";
import { test } from "node:test";
import type { SwarmDb } from "../../src/store/db.js";
import { int, text } from "../../src/store/rows.js";
import { chooseWorkRecipient } from "../../src/broker/work-notifications.js";
import { claimTask, handoffTask } from "../../src/broker/task-ownership.js";
import { reopenTask, requestTaskReview, reviewTask, startTask } from "../../src/broker/task-transitions.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { decideCriterionBlocker, recordCriterionBlocker } from "../../src/broker/blockers.js";
import { updatePostLinks } from "../../src/broker/post-links.js";
import { createPost } from "../../src/broker/wall.js";
import { editCriterion } from "../../src/broker/criteria.js";
import { assessCriterion } from "../../src/broker/criterion-status.js";
import { onLocalMessage } from "../../src/broker/notify.js";
import { onWorkChanged } from "../../src/broker/work-write.js";
import { workFixture } from "../helpers/work-graph.js";

function notices(db: SwarmDb, after = 0) {
  return db.sql
    .prepare(
      `SELECT m.id, m.body, r.name, (SELECT count(*) FROM message_recipients WHERE message_id = m.id) AS recipients
    FROM messages m JOIN message_recipients r ON r.message_id = m.id WHERE m.sender = 'System' AND m.id > ? ORDER BY m.id`,
    )
    .all(after)
    .map((row) => ({
      id: int(row, "id"),
      body: text(row, "body"),
      to: text(row, "name"),
      recipients: int(row, "recipients"),
    }));
}
function last(db: SwarmDb): number {
  return notices(db).at(-1)?.id ?? 0;
}

test("recipient selection is pure, prefers idle then load and name, falls back to active", () => {
  const agents = [
    { name: "Ann", active: true, idle: false, openTasks: 0 },
    { name: "Ben", active: true, idle: true, openTasks: 2 },
    { name: "Cam", active: true, idle: true, openTasks: 1 },
    { name: "Dan", active: true, idle: true, openTasks: 1 },
    { name: "Eve", active: false, idle: true, openTasks: 0 },
  ];
  assert.equal(chooseWorkRecipient(agents, []), "Cam");
  assert.equal(chooseWorkRecipient(agents, ["Cam"]), "Dan");
  assert.equal(chooseWorkRecipient(agents, ["Cam", "Dan", "Ben"]), "Ann");
  assert.equal(chooseWorkRecipient(agents, ["Cam", "Dan", "Ben", "Ann"]), null);
  assert.equal(agents[0]?.name, "Ann");
});

test("handoff, review request, review result and vote duty go to one recipient per durable message", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  handoffTask(f.db, { ...f.input(), id: task.id, to: "Ben" });
  assert.deepEqual(
    notices(f.db).map((notice) => notice.to),
    ["Ben"],
  );
  f.db.sql
    .prepare("UPDATE participants SET status = 'idle' WHERE swarm_id = ? AND name IN ('Cam','Dan')")
    .run(f.swarmId);
  startTask(f.db, { ...f.input("Ben"), id: task.id });
  requestTaskReview(f.db, { ...f.input("Ben"), id: task.id, evidence: "Tests pass" });
  assert.equal(notices(f.db).at(-1)?.to, "Cam");
  const cursor = last(f.db);
  reviewTask(f.db, { ...f.input("Cam"), id: task.id, verdict: "accept", reason: "Checked" });
  const messages = notices(f.db, cursor);
  assert.deepEqual(
    messages.map((message) => message.to),
    ["Ben", "Ben", "Cam"],
  );
  assert.equal(messages.filter((message) => message.body.includes("needs your vote")).length, 1);
  assert.equal(messages.filter((message) => message.body.includes("independent vote")).length, 1);
  assert.ok(notices(f.db).every((message) => message.recipients === 1));
  assert.throws(
    () => reviewTask(f.db, { ...f.input("Cam"), id: task.id, verdict: "accept", reason: "Again" }),
    /requires review/,
  );
  assert.equal(notices(f.db, cursor).length, messages.length);
});

test("dependencies ready, dependency reopen and stale votes notify exactly the affected agents", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task(f.criterion.id, [first.id]);
  claimTask(f.db, { ...f.input("Ben"), id: second.id });
  let cursor = last(f.db);
  f.accept(first.id);
  const ready = notices(f.db, cursor).filter((message) => message.body.includes("Dependencies ready"));
  assert.deepEqual(
    ready.map((message) => message.to),
    ["Ben"],
  );
  f.accept(second.id, "Ben", "Ann");
  for (const actor of ["Ann", "Ben", "Cam"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "satisfied", reason: "Checked" });
  cursor = last(f.db);
  reopenTask(f.db, { ...f.input(), id: first.id, reason: "Regression" });
  const reopened = notices(f.db, cursor);
  assert.deepEqual(
    reopened.filter((message) => message.body.includes("reopened dependency")).map((message) => message.to),
    ["Ben"],
  );
  assert.deepEqual(
    reopened.filter((message) => message.body.includes("is stale")).map((message) => message.to),
    ["Ann", "Ben", "Cam"],
  );
  assert.ok(assessCriterion(f.db, f.swarmId, f.criterion.id).votes.every((vote) => vote.stale));
  cursor = last(f.db);
  editCriterion(f.db, { ...f.input(), id: f.criterion.id, expectedRevision: 1, fields: { title: "Clarify" } });
  assert.deepEqual(notices(f.db, cursor), [], "already stale votes are not repeatedly notified");
});

test("User blocker decisions notify required owners and independent voters once", (t) => {
  const f = workFixture(t);
  f.task(f.criterion.id, [], true);
  recordCriterionBlocker(f.db, {
    ...f.input(),
    criterionId: f.criterion.id,
    reason: "No access",
    missing: "Token",
    attempted: "Requested",
    unblock: "Grant access",
  });
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "blocked", reason: "Confirmed" });
  const cursor = last(f.db);
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "reject" });
  assert.deepEqual(
    notices(f.db, cursor).map((message) => message.to),
    ["Ann", "Ben"],
  );
  assert.ok(notices(f.db, cursor).every((message) => message.body.includes("Keep working")));
  assert.throws(
    () => decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "reject" }),
    /already recorded/,
  );
  assert.equal(notices(f.db, cursor).length, 2);
});

test("post linking notifies the task owner without subscribing and repeated links are idempotent", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const post = createPost(f.db, f.swarmId, "Ben", { title: "Evidence", text: "Test logs" }, f.input().now);
  const before = f.db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id);
  const cursor = last(f.db);
  const input = { ...f.input("Ben"), postId: post.id, taskIds: [task.id], criterionIds: [f.criterion.id] };
  assert.equal(updatePostLinks(f.db, input).links.length, 2);
  updatePostLinks(f.db, input);
  assert.deepEqual(
    notices(f.db, cursor).map((message) => message.to),
    ["Ann"],
  );
  assert.deepEqual(f.db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id), before);
  updatePostLinks(f.db, { ...input, remove: true });
  assert.equal(notices(f.db, cursor).length, 1);
});

test("failed transactions roll back graph, outbox and notifications and do not wake delivery", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const before = f.db.sql.prepare("SELECT count(*) AS n FROM events").get()?.n;
  const delivered: number[] = [];
  const changed: number[] = [];
  const removeDelivery = onLocalMessage((id) => delivered.push(id));
  const removeWork = onWorkChanged((id) => changed.push(id));
  t.after(removeDelivery);
  t.after(removeWork);
  assert.throws(
    () =>
      f.db.write(() => {
        handoffTask(f.db, { ...f.input(), id: task.id, to: "Ben" });
        assert.deepEqual(delivered, []);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(notices(f.db), []);
  assert.deepEqual(delivered, []);
  assert.deepEqual(changed, []);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM events").get()?.n, before);
  handoffTask(f.db, { ...f.input(), id: task.id, to: "Ben" });
  assert.deepEqual(delivered, [f.swarmId]);
  assert.deepEqual(changed, [f.swarmId]);
});

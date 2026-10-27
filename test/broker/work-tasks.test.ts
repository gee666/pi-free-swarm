import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { createTask, editTask } from "../../src/broker/tasks.js";
import { archiveCriterion } from "../../src/broker/criteria.js";
import { claimTask, handoffTask, releaseTask } from "../../src/broker/task-ownership.js";
import { reopenTask, requestTaskReview, reviewTask, startTask } from "../../src/broker/task-transitions.js";
import { getTaskDetail, searchTaskCandidates } from "../../src/broker/work-queries.js";
import { getTask, taskTimeline } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";

test("create requires nonarchived same-swarm criteria and contributions, ownership is explicit", (t) => {
  const f = workFixture(t);
  const base = { ...f.input(), title: "Test", body: "Test it." };
  assert.throws(() => createTask(f.db, { ...base, criteria: [] }), /at least one/);
  assert.throws(
    () => createTask(f.db, { ...base, criteria: [{ criterionId: 999, contribution: "test" }] }),
    /not found/,
  );
  assert.throws(
    () => createTask(f.db, { ...base, criteria: [{ criterionId: f.criterion.id, contribution: " " }] }),
    /required/,
  );
  const task = f.task();
  assert.equal(task.status, "new");
  assert.equal(task.owner, null);
  const claimed = f.task(f.criterion.id, [], true);
  assert.equal(claimed.owner, "Ann");
  assert.equal(claimed.status, "claimed");
  archiveCriterion(f.db, { ...f.input(), id: f.criterion.id });
  assert.throws(() => f.task(), /archived/);
});

test("task lifecycle enforces owner, evidence, independent review and revision conflicts", (t) => {
  const f = workFixture(t);
  const task = f.task();
  assert.throws(() => startTask(f.db, { ...f.input(), id: task.id }), /owner|requires claimed/);
  claimTask(f.db, { ...f.input(), id: task.id });
  assert.throws(() => claimTask(f.db, { ...f.input("Ben"), id: task.id }), /active Ann/);
  assert.throws(() => startTask(f.db, { ...f.input("Ben"), id: task.id }), /Only owner/);
  assert.throws(
    () =>
      editTask(f.db, { ...f.input(), id: task.id, expectedRevision: task.revision, fields: { title: "Lost update" } }),
    /Reread/,
  );
  startTask(f.db, { ...f.input(), id: task.id });
  assert.throws(() => requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: " " }), /required/);
  requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: "npm test: passed" });
  assert.throws(
    () => reviewTask(f.db, { ...f.input(), id: task.id, verdict: "accept", reason: "Mine" }),
    /must not be/,
  );
  assert.throws(() => handoffTask(f.db, { ...f.input(), id: task.id, to: "Ben" }), /review/);
  assert.throws(
    () => reviewTask(f.db, { ...f.input("Ben"), id: task.id, verdict: "changes", reason: " " }),
    /required/,
  );
  const changes = reviewTask(f.db, {
    ...f.input("Ben"),
    id: task.id,
    verdict: "changes",
    reason: "Add regression tests",
  });
  assert.equal(changes.status, "in_progress");
  requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: "Regression passes" });
  const accepted = reviewTask(f.db, { ...f.input("User"), id: task.id, verdict: "accept", reason: "Checked" });
  assert.equal(accepted.acceptedBy, "User");
  assert.ok(accepted.acceptedAt);
  assert.throws(
    () => requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: "again" }),
    /requires in_progress/,
  );
  assert.throws(() => reopenTask(f.db, { ...f.input(), id: task.id, reason: "" }), /required/);
  const reopened = reopenTask(f.db, { ...f.input("Ben"), id: task.id, reason: "Regression found" });
  assert.equal(reopened.status, "in_progress");
  assert.equal(reopened.owner, "Ann");
  assert.equal(reopened.acceptedAt, null);
  assert.deepEqual(
    taskTimeline(f.db, task.id).map((event) => event.kind),
    [
      "created",
      "claimed",
      "started",
      "review_requested",
      "changes_requested",
      "review_requested",
      "review_accepted",
      "reopened",
    ],
  );
  assert.equal(getTaskDetail(f.db, f.swarmId, task.id).latestEvidence, "Regression passes");
});

test("dependency cycles, waiting and runnable are derived and start is gated", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task(f.criterion.id, [first.id]);
  const third = f.task(f.criterion.id, [second.id]);
  assert.equal(getTaskDetail(f.db, f.swarmId, second.id).waiting, true);
  assert.ok(searchTaskCandidates(f.db, f.swarmId, "Ann", { waiting: true }).some((task) => task.id === second.id));
  assert.ok(searchTaskCandidates(f.db, f.swarmId, "Ann", { runnable: true }).some((task) => task.id === first.id));
  for (const id of [first.id, second.id, third.id]) {
    assert.throws(
      () =>
        editTask(f.db, { ...f.input(), id: first.id, expectedRevision: first.revision, fields: { dependsOn: [id] } }),
      /cycle/,
    );
  }
  claimTask(f.db, { ...f.input("Ben"), id: second.id });
  assert.throws(() => startTask(f.db, { ...f.input("Ben"), id: second.id }), /waiting/);
  f.accept(first.id);
  assert.equal(getTaskDetail(f.db, f.swarmId, second.id).waiting, false);
  assert.ok(taskTimeline(f.db, second.id).some((event) => event.kind === "dependencies_ready"));
  f.accept(second.id, "Ben", "Ann");
  reopenTask(f.db, { ...f.input(), id: first.id, reason: "A regression" });
  assert.ok(taskTimeline(f.db, second.id).some((event) => event.kind === "dependency_reopened"));
  assert.equal(getTaskDetail(f.db, f.swarmId, second.id).waiting, true);
});

test("offline owners permit takeover or handoff and reopen clears an offline owner", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  assert.throws(() => handoffTask(f.db, { ...f.input("Cam"), id: task.id, to: "Ben" }), /Only owner/);
  f.db.sql.prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND name = 'Ann'").run(f.swarmId);
  const taken = claimTask(f.db, { ...f.input("Ben"), id: task.id });
  assert.equal(taken.owner, "Ben");
  assert.equal(taken.status, "claimed");
  handoffTask(f.db, { ...f.input("Ben"), id: task.id, to: "Cam" });
  assert.throws(() => handoffTask(f.db, { ...f.input("Cam"), id: task.id, to: "Ann" }), /active agent/);
  releaseTask(f.db, { ...f.input("Cam"), id: task.id });
  assert.equal(getTask(f.db, f.swarmId, task.id)?.owner, null);
  f.accept(task.id, "Ben", "Cam");
  f.db.sql
    .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Ben'")
    .run(f.input().now, f.swarmId);
  const reopened = reopenTask(f.db, { ...f.input("Cam"), id: task.id, reason: "Repair" });
  assert.equal(reopened.status, "new");
  assert.equal(reopened.owner, null);
});

test("two concurrent processes claiming the same task have exactly one winner", { timeout: 15000 }, async (t) => {
  const f = workFixture(t);
  const task = f.task();
  const children = ["Ann", "Ben"].map((name) =>
    fork(new URL("./fixtures/claim-work.ts", import.meta.url), [f.db.path, String(f.swarmId), String(task.id), name], {
      execArgv: ["--import", "tsx/esm"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }),
  );
  t.after(() => {
    for (const child of children) child.kill();
  });
  await Promise.all(children.map((child) => once(child, "message")));
  const results = children.map((child) => once(child, "message"));
  const exits = children.map((child) => once(child, "exit"));
  for (const child of children) child.send("claim");
  const messages: unknown[] = (await Promise.all(results)).map(([message]) => message);
  await Promise.all(exits);
  assert.equal(
    messages.filter(
      (message) => typeof message === "object" && message !== null && "ok" in message && message.ok === true,
    ).length,
    1,
  );
  assert.equal(taskTimeline(f.db, task.id).filter((event) => event.kind === "claimed").length, 1);
});

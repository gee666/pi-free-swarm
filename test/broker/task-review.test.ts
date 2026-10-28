import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseReviewVerdict } from "../../src/agents/review-process.js";
import { REVIEW_CONTEXT_MAX } from "../../src/constants.js";
import {
  beginTaskReview,
  finishTaskReview,
  resetOrphanedReviews,
  reviewSessionFile,
} from "../../src/broker/task-review.js";
import { startTask } from "../../src/broker/task-transitions.js";
import { editTask } from "../../src/broker/tasks.js";
import { editCriterion } from "../../src/broker/criteria.js";
import { getTask, taskTimeline } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";

const context = "Changed src/feature.ts. Verify with npm test.";

test("only an owner of in_progress work can request review, including resume", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const input = { ...f.input(), id: task.id, context };
  assert.throws(() => beginTaskReview(f.db, input), /requires in_progress/);
  startTask(f.db, input);
  for (const actor of ["Ben", "User"])
    assert.throws(() => beginTaskReview(f.db, { ...input, actor }), /Only the task owner/);
  assert.throws(() => beginTaskReview(f.db, { ...input, context: " " }), /context is required/);
  assert.throws(() => beginTaskReview(f.db, { ...input, context: "x".repeat(REVIEW_CONTEXT_MAX + 1) }), /at most 4000/);
  assert.throws(() => beginTaskReview(f.db, { ...input, resume: true }), /session file/);
  const review = beginTaskReview(f.db, { ...input, context: "😀".repeat(REVIEW_CONTEXT_MAX) });
  assert.equal(review.task.status, "review");
  assert.throws(() => beginTaskReview(f.db, input), /requires in_progress/);
  finishTaskReview(f.db, { ...input, revision: review.task.revision, verdict: "accept", reason: "Verified" });
  assert.throws(() => beginTaskReview(f.db, input), /requires in_progress/);
});

test("review input includes task and complete linked criteria, including attached long text", (t) => {
  const f = workFixture(t);
  const body = "Requirement with details\n".repeat(1000).trim();
  const verification = "Run these tests\n".repeat(1000).trim();
  editCriterion(f.db, { ...f.input("User"), id: f.criterion.id, expectedRevision: 1, fields: { body, verification } });
  const task = f.task(f.criterion.id, [], true);
  startTask(f.db, { ...f.input(), id: task.id });
  const review = beginTaskReview(f.db, { ...f.input(), id: task.id, context });
  assert.ok(review.prompt.includes(JSON.stringify(body)));
  assert.ok(review.prompt.includes(JSON.stringify(verification)));
  assert.ok(review.prompt.includes(task.title));
  assert.ok(review.prompt.includes(task.body));
  assert.ok(review.prompt.includes(context));
});

test("verdicts use the last standalone verdict outside code fences", () => {
  for (const [text, expected] of [
    ["Tests passed.\nVERDICT: accept", "accept"],
    ["VERDICT: changes\n1. Missing regression coverage.\n2. Errors are swallowed.", "changes"],
    ["Problems found.\r\nVERDICT: changes — Missing regression coverage.\r\n", "changes"],
    ["VERDICT: accept\nExtra text", "accept"],
    ["**VERDICT: changes**\n- Handle empty input in src/parse.ts.", "changes"],
    ["### *verdict: accept*", "accept"],
    ["- **VERDICT:** CHANGES — Fix src/parse.ts.", "changes"],
    ["1. _verdict: changes_\nMissing regression coverage.", "changes"],
    ["VERDICT: changes\nExample:\n```text\nVERDICT: accept\n```", "changes"],
    ['```ts\nconst example = "VERDICT: accept";\n```\nVERDICT: changes\nVERDICT: accept', "accept"],
    ["```text\nVERDICT: accept\n```", null],
    ['"VERDICT: accept"', null],
    ["VERDICT: acceptable", null],
    ["VERDICT: acceptably good", null],
    ["Example VERDICT: accept", null],
    ["VERDICT: changes\nVERDICT: accept", "accept"],
    ["", null],
  ] satisfies [string, "accept" | "changes" | null][])
    assert.equal(parseReviewVerdict(text), expected, text);
});

test("accept and changes update the timeline without peer notifications or invalidating votes", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  startTask(f.db, { ...f.input(), id: task.id });
  const input = { ...f.input(), id: task.id, context };
  const review = beginTaskReview(f.db, input);
  const changes = finishTaskReview(f.db, {
    ...input,
    revision: review.task.revision,
    verdict: "changes",
    reason: "Add regression test",
  });
  assert.equal(changes.status, "in_progress");
  assert.equal(changes.acceptedBy, null);
  const again = beginTaskReview(f.db, input);
  const accepted = finishTaskReview(f.db, {
    ...input,
    revision: again.task.revision,
    verdict: "accept",
    reason: "Tests and diff checked",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.acceptedBy, "Ann review");
  assert.equal(accepted.acceptedAt, input.now);
  assert.equal(accepted.contentRevision, task.contentRevision);
  assert.deepEqual(
    taskTimeline(f.db, task.id)
      .slice(-4)
      .map((event) => event.kind),
    ["review_requested", "changes_requested", "review_requested", "review_accepted"],
  );
  assert.equal(taskTimeline(f.db, task.id).at(-1)?.body, "Tests and diff checked");
  assert.deepEqual(f.db.sql.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(f.db.sql.prepare("SELECT 1 FROM messages WHERE body LIKE '%swarm_tasks_review%'").get(), undefined);
});

for (const verdict of ["changes", null] satisfies ("changes" | null)[])
  test(`resume after ${verdict ?? "unparsable"} needs only an existing task-specific session`, (t) => {
    const f = workFixture(t);
    const task = f.task(f.criterion.id, [], true);
    startTask(f.db, { ...f.input(), id: task.id });
    const input = { ...f.input(), id: task.id, context };
    const first = beginTaskReview(f.db, input);
    finishTaskReview(f.db, { ...input, revision: first.task.revision, verdict, reason: "Fix test" });
    assert.throws(() => beginTaskReview(f.db, { ...input, resume: true }), /session file/);
    mkdirSync(path.dirname(first.sessionFile), { recursive: true });
    writeFileSync(first.sessionFile, "session fixture");
    const resumed = beginTaskReview(f.db, { ...input, resume: true });
    assert.equal(resumed.sessionFile, first.sessionFile);
    const second = f.task(f.criterion.id, [], true);
    assert.notEqual(reviewSessionFile(f.db, f.swarmId, second.id), resumed.sessionFile);
    assert.equal(existsSync(reviewSessionFile(f.db, f.swarmId, second.id)), false);
  });

test("startup resets abandoned reviews but leaves live reviewers alone", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  startTask(f.db, { ...f.input(), id: task.id });
  beginTaskReview(f.db, { ...f.input(), id: task.id, context });
  resetOrphanedReviews(f.db, f.swarmId, f.input().now, () => true);
  assert.equal(getTask(f.db, f.swarmId, task.id)?.status, "review");
  resetOrphanedReviews(f.db, f.swarmId, f.input().now, () => false);
  assert.equal(getTask(f.db, f.swarmId, task.id)?.status, "in_progress");
  assert.match(taskTimeline(f.db, task.id).at(-1)?.body ?? "", /no live reviewer/);
  f.db.sql.prepare("UPDATE tasks SET status = 'review' WHERE id = ?").run(task.id);
  f.db.sql.prepare("DELETE FROM task_reviews WHERE task_id = ?").run(task.id);
  resetOrphanedReviews(f.db, f.swarmId, f.input().now);
  assert.equal(getTask(f.db, f.swarmId, task.id)?.status, "in_progress");
});

test("edits during review cannot accept a stale snapshot", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  startTask(f.db, { ...f.input(), id: task.id });
  const input = { ...f.input(), id: task.id, context };
  const review = beginTaskReview(f.db, input);
  editTask(f.db, {
    ...input,
    expectedRevision: review.task.revision,
    fields: { body: "Changed after review started" },
  });
  const result = finishTaskReview(f.db, {
    ...input,
    revision: review.task.revision,
    verdict: "accept",
    reason: "Old snapshot passed",
  });
  assert.equal(result.status, "in_progress");
  assert.match(taskTimeline(f.db, task.id).at(-1)?.body ?? "", /changed during review/);
});

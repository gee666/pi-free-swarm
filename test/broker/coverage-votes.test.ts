import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCriterion, linksSignature } from "../../src/broker/criterion-status.js";
import { createCriterion } from "../../src/broker/criteria.js";
import { claimTask, handoffTask, releaseTask } from "../../src/broker/task-ownership.js";
import { reopenTask, requestTaskReview, reviewTask, startTask } from "../../src/broker/task-transitions.js";
import { editTask } from "../../src/broker/tasks.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { searchCriterionCandidates } from "../../src/broker/work-queries.js";
import { getTask, taskLinks } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";

test("early covered votes survive lifecycle changes; satisfaction still requires every task accepted", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task();
  for (const actor of ["Ann", "Ben", "Cam"])
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "covered",
      reason: "Implementation and tests cover the requirement",
    });
  const check = (status: "incomplete" | "satisfied") => {
    const state = assessCriterion(f.db, f.swarmId, f.criterion.id);
    assert.equal(state.status, status);
    assert.ok(state.votes.every((vote) => !vote.stale));
    assert.deepEqual(
      searchCriterionCandidates(f.db, f.swarmId, "Ann", { status: [status], group: "Delivery" }).map((item) => item.id),
      [f.criterion.id],
    );
    for (const id of [first.id, second.id]) assert.equal(getTask(f.db, f.swarmId, id)?.contentRevision, 1);
  };
  check("incomplete");
  claimTask(f.db, { ...f.input(), id: first.id });
  check("incomplete");
  startTask(f.db, { ...f.input(), id: first.id });
  check("incomplete");
  requestTaskReview(f.db, { ...f.input(), id: first.id, evidence: "Tests passed" });
  check("incomplete");
  reviewTask(f.db, { ...f.input("Ben"), id: first.id, verdict: "changes", reason: "Fix regression" });
  check("incomplete");
  requestTaskReview(f.db, { ...f.input(), id: first.id, evidence: "Regression test passes" });
  reviewTask(f.db, { ...f.input("Ben"), id: first.id, verdict: "accept", reason: "Tests verified" });
  check("incomplete");
  f.accept(second.id);
  check("satisfied");
  handoffTask(f.db, { ...f.input(), id: first.id, to: "Cam" });
  check("satisfied");
  reopenTask(f.db, { ...f.input("Cam"), id: first.id, reason: "Regression" });
  check("incomplete");
  releaseTask(f.db, { ...f.input("Cam"), id: first.id });
  check("incomplete");
  f.accept(first.id);
  check("satisfied");
});

test("only changed coverage content bumps content revision, including contribution and link edits", (t) => {
  const f = workFixture(t);
  let task = f.task();
  const dependency = f.task();
  const other = createCriterion(f.db, {
    ...f.input(),
    group: "Other",
    title: "Other requirement",
    body: "Other work",
    verification: "Test",
    source: "",
  });
  const vote = () =>
    voteCriterion(f.db, {
      ...f.input(),
      criterionId: f.criterion.id,
      verdict: "covered",
      reason: "Tasks cover the requirement",
    });
  const edit = (fields: Parameters<typeof editTask>[1]["fields"], changesCoverage: boolean) => {
    vote();
    const before = task;
    task = editTask(f.db, { ...f.input(), id: task.id, expectedRevision: task.revision, fields });
    assert.equal(task.revision, before.revision + 1);
    assert.equal(task.contentRevision, before.contentRevision + Number(changesCoverage));
    assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).votes[0]?.stale, changesCoverage);
  };
  edit({ title: "New title" }, true);
  edit({ body: "New implementation scope" }, true);
  edit({ criteria: [{ criterionId: f.criterion.id, contribution: "More verification" }] }, true);
  edit({ criteria: [...taskLinks(f.db, task.id), { criterionId: other.id, contribution: "Other coverage" }] }, true);
  edit({ title: task.title, body: task.body, criteria: taskLinks(f.db, task.id).reverse() }, false);
  edit({ dependsOn: [dependency.id] }, false);
  edit({ dependsOn: [] }, false);
  edit({ criteria: [{ criterionId: f.criterion.id, contribution: "More verification" }] }, true);
  assert.equal(linksSignature([dependency, task]), `${task.id}:${task.contentRevision},${dependency.id}:1`);
});

test("gap votes require a reason naming the missing part and veto satisfaction", (t) => {
  const f = workFixture(t);
  const task = f.task();
  assert.throws(
    () => voteCriterion(f.db, { ...f.input(), criterionId: f.criterion.id, verdict: "gap", reason: " " }),
    /must name the missing part/,
  );
  voteCriterion(f.db, {
    ...f.input(),
    criterionId: f.criterion.id,
    verdict: "covered",
    reason: "Implementation and tests cover the requirement",
  });
  voteCriterion(f.db, {
    ...f.input("Ben"),
    criterionId: f.criterion.id,
    verdict: "gap",
    reason: "Missing accessibility verification",
  });
  f.accept(task.id);
  const state = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(state.status, "incomplete");
  assert.ok(state.reasons.includes("Ben: gap: Missing accessibility verification"));
  assert.ok(state.votes.every((vote) => !vote.stale));
});

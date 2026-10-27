import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveCriterion, createCriterion } from "../../src/broker/criteria.js";
import { editTask } from "../../src/broker/tasks.js";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { readProject } from "../../src/broker/project.js";
import { endRun } from "../../src/broker/swarms.js";
import { prepareWorkRunCompletion } from "../../src/broker/work-run-completion.js";
import { recordCriterionBlocker, decideCriterionBlocker } from "../../src/broker/blockers.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { assessCriterion } from "../../src/broker/criterion-status.js";
import { isActiveOwner } from "../../src/broker/work-validation.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { taskStates, criterionStates } from "../../src/store/work-state.js";
import { workRoster } from "../../src/store/work-roster.js";
import { workFixture } from "../helpers/work-graph.js";

test("worker tool writes are fenced by run identity and admission, but User can invalidate completion during drain", (t) => {
  const f = workFixture(t);
  const tools = (run: number) =>
    createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run, agentName: "Ann" });
  const fields = { group: "Safety", title: "New requirement", body: "Verify", verification: "Test", source: "" };
  assert.throws(() => tools(999).criteriaCreate(fields), /run is closing\/ended/);
  f.settle();
  const close = () =>
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 1, runnerPid: process.pid, now: f.input().now });
  assert.equal(close().kind, "closed");
  assert.throws(() => tools(1).criteriaCreate(fields), /run is closing\/ended/);
  createCriterion(f.db, { ...f.input("User"), ...fields });
  assert.equal(endRun(f.db, f.swarmId, process.pid, "finished", f.input().now, 1), false);
  assert.equal(readProject(f.db, f.swarmId).outcome, null);
  assert.doesNotThrow(() => tools(1).criteriaCreate({ ...fields, title: "Admission reopened" }));
  f.settle();
  assert.equal(close().kind, "closed");
  assert.equal(endRun(f.db, f.swarmId, process.pid, "finished", f.input().now, 1), true);
  assert.throws(() => tools(1).criteriaCreate(fields), /run is closing\/ended/);
});

test("no active criteria cannot pass the linked gate", (t) => {
  const f = workFixture(t);
  for (const criterion of criterionStates(f.db, f.swarmId))
    archiveCriterion(f.db, { ...f.input("User"), id: criterion.id });
  const completion = evaluateCompletion(f.db, f.swarmId);
  assert.equal(completion.done, false);
  assert.equal(completion.gates.find((gate) => gate.key === "linked")?.count, 1);
});

test("retired owners remain offline after the run ends, non-retired stopped owners become eligible", (t) => {
  const f = workFixture(t);
  const task = f.task();
  f.accept(task.id);
  f.settle();
  f.db.sql
    .prepare("UPDATE participants SET retired_at = ?, status = 'stopped' WHERE swarm_id = ? AND name = 'Ann'")
    .run(f.input().now, f.swarmId);
  endRun(f.db, f.swarmId, process.pid, "stopped", f.input().now, 1);
  assert.equal(workRoster(f.db, f.swarmId).find((agent) => agent.name === "Ann")?.active, false);
  assert.equal(isActiveOwner(f.db, f.swarmId, "Ann"), false);
  assert.equal(isActiveOwner(f.db, f.swarmId, "Ben"), true);
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "incomplete");
  assert.ok(assessCriterion(f.db, f.swarmId, f.criterion.id).offlineTasks.includes(task.id));
  assert.equal(criterionStates(f.db, f.swarmId).find((criterion) => criterion.id === f.criterion.id)?.offlineCount, 1);
});

test("mixed blocked links defer a task only while all agreements remain current", (t) => {
  const f = workFixture(t);
  f.settle();
  const second = createCriterion(f.db, {
    ...f.input(),
    group: "Exceptions",
    title: "External dependency",
    body: "Needs access",
    verification: "Check access",
    source: "",
  });
  const task = f.task(second.id, [], true);
  editTask(f.db, {
    ...f.input(),
    id: task.id,
    expectedRevision: task.revision,
    fields: {
      criteria: [
        { criterionId: second.id, contribution: "External integration" },
        { criterionId: f.criterion.id, contribution: "Delivery" },
      ],
    },
  });
  for (const id of [f.criterion.id, second.id]) {
    recordCriterionBlocker(f.db, {
      ...f.input(),
      criterionId: id,
      reason: "No access",
      missing: "Credentials",
      attempted: "Checked environment",
      unblock: "Provide access",
    });
    for (const actor of ["Ann", "Ben"])
      voteCriterion(f.db, { ...f.input(actor), criterionId: id, verdict: "blocked", reason: "Confirmed" });
  }
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, true);
  assert.equal(taskStates(f.db, f.swarmId).find((state) => state.id === task.id)?.deferred, true);
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: second.id, decision: "reject" });
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, false);
  assert.equal(taskStates(f.db, f.swarmId).find((state) => state.id === task.id)?.deferred, false);
});

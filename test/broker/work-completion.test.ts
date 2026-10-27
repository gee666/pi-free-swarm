import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { approveScope, readProject, updateProjectIntent } from "../../src/broker/project.js";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { prepareWorkRunCompletion } from "../../src/broker/work-run-completion.js";
import { archiveCriterion, editCriterion, restoreCriterion } from "../../src/broker/criteria.js";
import { decideCriterionBlocker, recordCriterionBlocker } from "../../src/broker/blockers.js";
import { createTask } from "../../src/broker/tasks.js";
import { claimTask } from "../../src/broker/task-ownership.js";
import { requestTaskReview, startTask } from "../../src/broker/task-transitions.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { workDashboard } from "../../src/broker/work-queries.js";
import { endRun } from "../../src/broker/swarms.js";
import { listCriteria } from "../../src/store/criteria.js";
import { listTasks } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";
import { T0 } from "../helpers/temp-db.js";

function agreement(f: ReturnType<typeof workFixture>, criterionId: number) {
  recordCriterionBlocker(f.db, {
    ...f.input(),
    criterionId,
    reason: "External access needed",
    missing: "Token",
    attempted: "Access requested",
    unblock: "User grants access",
  });
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId, verdict: "blocked", reason: "Confirmed" });
}

test("swarm creation writes full brief and seeds Planning tasks and Main criteria", (t) => {
  const f = workFixture(t);
  const project = readProject(f.db, f.swarmId);
  assert.equal(project.briefPath, `.pi/swarm/work/${f.swarmId}/brief.md`);
  assert.equal(
    readFileSync(path.join(f.cwd, project.briefPath ?? ""), "utf8"),
    "Build the thing. Requirements: docs/req.md",
  );
  const criteria = listCriteria(f.db, f.swarmId);
  assert.ok(
    criteria.some(
      (criterion) =>
        criterion.group === "Planning" &&
        criterion.title === "Record the user intent and establish acceptance coverage",
    ),
  );
  assert.ok(criteria.some((criterion) => criterion.group === "Main" && criterion.author === "Main"));
  assert.deepEqual(
    listTasks(f.db, f.swarmId).map((task) => [task.title, task.status, task.owner]),
    [
      ["Record the user intent", "new", null],
      ["Draft acceptance criteria", "new", null],
    ],
  );
});

test("five stop gates fail independently and idleness never completes work", (t) => {
  const f = workFixture(t);
  const initial = evaluateCompletion(f.db, f.swarmId);
  assert.deepEqual(
    initial.gates.map((gate) => [gate.key, gate.ok]),
    [
      ["scope", false],
      ["linked", false],
      ["tasks", false],
      ["criteria", false],
      ["review", true],
    ],
  );
  assert.equal(initial.awaitingUser, false);
  assert.equal(initial.outcome, null);
  const task = f.task();
  claimTask(f.db, { ...f.input(), id: task.id });
  startTask(f.db, { ...f.input(), id: task.id });
  requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: "Tests pass" });
  assert.equal(evaluateCompletion(f.db, f.swarmId).gates.find((gate) => gate.key === "review")?.count, 1);
  f.db.sql.prepare("UPDATE participants SET status = 'idle' WHERE swarm_id = ? AND kind = 'agent'").run(f.swarmId);
  assert.equal(
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 1, runnerPid: process.pid, now: T0 }).kind,
    "pending",
  );
});

test("scope re-approval is required after criterion edits, archive/restore and intent changes", (t) => {
  const f = workFixture(t);
  f.settle();
  const waiting = evaluateCompletion(f.db, f.swarmId);
  assert.equal(waiting.awaitingUser, true);
  assert.equal(waiting.done, false);
  assert.throws(() => approveScope(f.db, f.input()), /Only User/);
  const approved = approveScope(f.db, f.input("User"));
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, true);
  const intent = updateProjectIntent(f.db, {
    ...f.input(),
    summary: "Build and verify the feature.",
    path: "docs/intent.md",
    expectedRevision: 0,
  });
  assert.equal(intent.intentRevision, 1);
  assert.equal(intent.scopeRevision, approved.scopeRevision + 1);
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, true);
  assert.throws(() => approveScope(f.db, { ...f.input("User"), expectedRevision: approved.scopeRevision }), /Reread/);
  approveScope(f.db, f.input("User"));
  editCriterion(f.db, {
    ...f.input(),
    id: f.criterion.id,
    expectedRevision: f.criterion.revision,
    fields: { verification: "Run regression suite" },
  });
  assert.equal(evaluateCompletion(f.db, f.swarmId).gates.find((gate) => gate.key === "scope")?.ok, false);
  archiveCriterion(f.db, { ...f.input(), id: f.criterion.id });
  approveScope(f.db, f.input("User"));
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, true);
  restoreCriterion(f.db, { ...f.input("User"), id: f.criterion.id });
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, false);
});

test("completed outcome is persisted only by an owning active runner", (t) => {
  const f = workFixture(t);
  f.settle();
  approveScope(f.db, f.input("User"));
  assert.equal(evaluateCompletion(f.db, f.swarmId).outcome, "completed");
  assert.equal(readProject(f.db, f.swarmId).outcome, null);
  assert.equal(
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 2, runnerPid: process.pid, now: T0 }).kind,
    "lost",
  );
  assert.equal(readProject(f.db, f.swarmId).outcome, null);
  assert.equal(
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 1, runnerPid: process.pid, now: T0 }).kind,
    "closed",
  );
  assert.equal(readProject(f.db, f.swarmId).outcome, "completed");
  assert.equal(endRun(f.db, f.swarmId, process.pid, "finished", T0, 1), true);
  assert.equal(f.db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(f.swarmId)?.status, "finished");
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, true);
  assert.ok(evaluateCompletion(f.db, f.swarmId).gates.every((gate) => gate.ok));
});

test("pending/rejected exceptions do not complete, approved exceptions defer tasks and yield stopped_with_blockers", (t) => {
  const f = workFixture(t);
  for (const criterion of listCriteria(f.db, f.swarmId)) {
    if (criterion.id !== f.criterion.id) archiveCriterion(f.db, { ...f.input(), id: criterion.id });
  }
  // Existing Planning tasks remain real work even after their criterion is archived.
  for (const task of listTasks(f.db, f.swarmId)) f.accept(task.id);
  f.task(f.criterion.id, [], true);
  agreement(f, f.criterion.id);
  approveScope(f.db, f.input("User"));
  const pending = evaluateCompletion(f.db, f.swarmId);
  assert.equal(pending.done, false);
  assert.equal(pending.awaitingUser, true, "only User can approve the exception that defers this task");
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "reject" });
  assert.equal(evaluateCompletion(f.db, f.swarmId).done, false);
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "approve" });
  const completed = evaluateCompletion(f.db, f.swarmId);
  assert.equal(completed.done, true);
  assert.equal(completed.outcome, "stopped_with_blockers");
  assert.equal(
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 1, runnerPid: process.pid, now: T0 }).kind,
    "closed",
  );
  assert.equal(readProject(f.db, f.swarmId).outcome, "stopped_with_blockers");
});

test("pending exception is awaitingUser when all linked tasks are accepted", (t) => {
  const f = workFixture(t);
  f.settle();
  agreement(f, f.criterion.id);
  approveScope(f.db, f.input("User"));
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, true);
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "reject" });
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, false);
});

test("pending exceptions do not hide unfinished mixed-criterion tasks or reviews", (t) => {
  const f = workFixture(t);
  f.settle();
  const task = f.task(f.criterion.id, [], true);
  agreement(f, f.criterion.id);
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, true);
  startTask(f.db, { ...f.input(), id: task.id });
  requestTaskReview(f.db, { ...f.input(), id: task.id, evidence: "Checks pass" });
  agreement(f, f.criterion.id);
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, false);
});

test("a task with another linked criterion cannot be waived by one pending exception", (t) => {
  const f = workFixture(t);
  f.settle();
  const other = listCriteria(f.db, f.swarmId).find((criterion) => criterion.id !== f.criterion.id);
  assert.ok(other);
  createTask(f.db, {
    ...f.input(),
    title: "Mixed scope",
    body: "Contributes to two criteria",
    criteria: [
      { criterionId: f.criterion.id, contribution: "Pending external resource" },
      { criterionId: other.id, contribution: "Separate unfinished work" },
    ],
    claim: true,
  });
  archiveCriterion(f.db, { ...f.input(), id: other.id });
  agreement(f, f.criterion.id);
  assert.equal(evaluateCompletion(f.db, f.swarmId).awaitingUser, false);
});

test("stopped/interrupted runs never receive a completion outcome", (t) => {
  const f = workFixture(t);
  f.settle();
  approveScope(f.db, f.input("User"));
  endRun(f.db, f.swarmId, process.pid, "stopped", T0, 1);
  assert.equal(
    prepareWorkRunCompletion(f.db, { swarmId: f.swarmId, run: 1, runnerPid: process.pid, now: T0 }).kind,
    "lost",
  );
  assert.equal(readProject(f.db, f.swarmId).outcome, null);
});

test("dashboard exposes queues, activity, velocity and gated ETA", (t) => {
  const f = workFixture(t);
  f.settle();
  const tasks = listTasks(f.db, f.swarmId);
  const early = workDashboard(f.db, f.swarmId, T0 + 1000, "Ann");
  assert.equal(early.velocity.accepted15Minutes, tasks.length);
  assert.equal(early.velocity.etaMs, null);
  const extra = f.task();
  f.accept(extra.id);
  const now = T0 + 30 * 60_000;
  const dashboard = workDashboard(f.db, f.swarmId, now, "Ann");
  assert.ok(dashboard.velocity.accepted60Minutes >= 5);
  assert.equal(dashboard.velocity.accepted15Minutes, 0);
  assert.equal(dashboard.velocity.etaMs, 0);
  assert.ok(dashboard.recentActivity.length > 0);
});

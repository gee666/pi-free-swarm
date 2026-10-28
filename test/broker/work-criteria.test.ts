import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveCriterion, editCriterion, restoreCriterion } from "../../src/broker/criteria.js";
import { assessCriterion } from "../../src/broker/criterion-status.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { decideCriterionBlocker, recordCriterionBlocker } from "../../src/broker/blockers.js";
import { editTask } from "../../src/broker/tasks.js";
import { handoffTask } from "../../src/broker/task-ownership.js";
import { reopenTask } from "../../src/broker/task-transitions.js";
import {
  criterionVoteContext,
  getTaskDetail,
  searchCriterionCandidates,
  searchTaskCandidates,
} from "../../src/broker/work-queries.js";
import { listCriteria } from "../../src/store/criteria.js";
import { workFixture } from "../helpers/work-graph.js";

function blockedFixture(t: Parameters<typeof workFixture>[0]) {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const block = () =>
    recordCriterionBlocker(f.db, {
      ...f.input(),
      criterionId: f.criterion.id,
      reason: "Need credentials",
      missing: "Production token",
      attempted: "Requested access",
      unblock: "User provides token",
    });
  const vote = (actor: string) =>
    voteCriterion(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      verdict: "blocked",
      reason: "Confirmed missing credentials",
    });
  return { ...f, taskRecord: task, block, vote };
}

test("criterion fields, archival history, User-only restore", (t) => {
  const f = workFixture(t);
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "unlinked");
  const edited = editCriterion(f.db, {
    ...f.input(),
    id: f.criterion.id,
    expectedRevision: 1,
    fields: { group: "QA", source: "req.md", verification: "Run QA" },
  });
  assert.equal(edited.revision, 2);
  assert.equal(edited.group, "QA");
  assert.throws(
    () => editCriterion(f.db, { ...f.input(), id: f.criterion.id, expectedRevision: 1, fields: { title: "Lost" } }),
    /Reread/,
  );
  archiveCriterion(f.db, { ...f.input(), id: f.criterion.id, expectedRevision: 2 });
  assert.equal(
    listCriteria(f.db, f.swarmId).some((criterion) => criterion.id === f.criterion.id),
    false,
  );
  assert.equal(
    listCriteria(f.db, f.swarmId, true).some((criterion) => criterion.id === f.criterion.id),
    true,
  );
  assert.throws(() => restoreCriterion(f.db, { ...f.input(), id: f.criterion.id }), /Only User/);
  const restored = restoreCriterion(f.db, { ...f.input("User"), id: f.criterion.id });
  assert.equal(restored.revision, 4);
  assert.equal(restored.archivedAt, null);
});

test("satisfaction needs every owner and independent current votes, with any current negative vote vetoing", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task();
  voteCriterion(f.db, {
    ...f.input(),
    criterionId: f.criterion.id,
    verdict: "covered",
    reason: "Tasks cover the requirement",
  });
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "incomplete");
  f.accept(first.id);
  f.accept(second.id, "Ben");
  const vote = (actor: string, verdict: "covered" | "gap" = "covered") =>
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict, reason: "Checked" });
  vote("Ann");
  assert.deepEqual(assessCriterion(f.db, f.swarmId, f.criterion.id).missingCovered, ["Ben", "independent"]);
  vote("Ben");
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "incomplete");
  vote("User");
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "satisfied");
  vote("Cam", "gap");
  const incomplete = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(incomplete.status, "incomplete");
  assert.ok(incomplete.reasons.some((reason) => reason.includes("Cam: gap")));
  vote("Cam");
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "satisfied");
});

test("criterion edits, task content edits and link changes keep visible stale votes", (t) => {
  const f = workFixture(t);
  const task = f.task();
  const accepted = f.accept(task.id);
  const vote = () => {
    for (const actor of ["Ann", "Ben"])
      voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "covered", reason: "Checked" });
  };
  vote();
  const editedCriterion = editCriterion(f.db, {
    ...f.input(),
    id: f.criterion.id,
    expectedRevision: f.criterion.revision,
    fields: { title: "Better requirement" },
  });
  assert.ok(assessCriterion(f.db, f.swarmId, f.criterion.id).votes.every((vote) => vote.stale));
  vote();
  const editedTask = editTask(f.db, {
    ...f.input(),
    id: task.id,
    expectedRevision: accepted.revision,
    fields: { body: "Clarified work" },
  });
  assert.ok(assessCriterion(f.db, f.swarmId, f.criterion.id).votes.every((vote) => vote.stale));
  vote();
  const planning = listCriteria(f.db, f.swarmId).find((criterion) => criterion.group === "Planning");
  assert.ok(planning);
  editTask(f.db, {
    ...f.input(),
    id: task.id,
    expectedRevision: editedTask.revision,
    fields: { criteria: [{ criterionId: planning.id, contribution: "Coverage" }] },
  });
  const unlinked = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(unlinked.status, "unlinked");
  assert.ok(unlinked.votes.every((vote) => vote.stale));
  assert.equal(unlinked.revision, editedCriterion.revision);
  reopenTask(f.db, { ...f.input(), id: task.id, reason: "Fix it" });
  assert.equal(assessCriterion(f.db, f.swarmId, planning.id).status, "incomplete");
});

test("offline linked owners block agreement until an active agent takes the task", (t) => {
  const f = workFixture(t);
  const task = f.task();
  f.accept(task.id);
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "covered", reason: "Verified" });
  f.db.sql.prepare("UPDATE participants SET status = 'stopped' WHERE swarm_id = ? AND name = 'Ann'").run(f.swarmId);
  const offline = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(offline.status, "incomplete");
  assert.ok(offline.reasons.includes(`owner offline — hand off task #${task.id}`));
  handoffTask(f.db, { ...f.input("Cam"), id: task.id, to: "Cam" });
  for (const actor of ["Cam", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "covered", reason: "Rechecked" });
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "satisfied");
});

test("blockers are final by agreement; only User may reject and voters must keep working", (t) => {
  const f = blockedFixture(t);
  assert.throws(() => f.vote("Ann"), /blocker record/);
  const blocker = f.block();
  const reject = (actor = "User") =>
    decideCriterionBlocker(f.db, {
      ...f.input(actor),
      criterionId: f.criterion.id,
      decision: "reject",
      expectedRevision: blocker.revision,
    });
  assert.throws(() => reject(), /must agree/);
  f.vote("Ann");
  f.vote("Ben");
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "blocked");
  assert.equal(getTaskDetail(f.db, f.swarmId, f.taskRecord.id).deferred, true);
  assert.ok(
    searchTaskCandidates(f.db, f.swarmId, "Ann", { deferred: true }).some((task) => task.id === f.taskRecord.id),
  );
  assert.throws(() => reject("Ann"), /Only User/);
  reject();
  const rejected = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(rejected.status, "incomplete");
  assert.ok(rejected.votes.every((vote) => vote.stale));
  assert.equal(getTaskDetail(f.db, f.swarmId, f.taskRecord.id).deferred, false);
  assert.throws(() => f.vote("Ann"), /rejected/);
  assert.throws(() => reject(), /must agree/);
  for (const voter of ["Ann", "Ben"]) {
    assert.ok(
      f.db.sql
        .prepare(
          "SELECT body FROM messages WHERE swarm_id = ? AND body LIKE 'User rejected blocker%' AND id IN (SELECT message_id FROM message_recipients WHERE name = ?)",
        )
        .get(f.swarmId, voter),
    );
  }
  const edited = f.block();
  assert.equal(edited.revision, blocker.revision + 1);
  f.vote("Ann");
  f.vote("Ben");
  assert.equal(assessCriterion(f.db, f.swarmId, f.criterion.id).status, "blocked");
});

test("task is deferred only if every linked criterion is blocked", (t) => {
  const f = blockedFixture(t);
  f.block();
  f.vote("Ann");
  f.vote("Ben");
  const planning = listCriteria(f.db, f.swarmId).find((criterion) => criterion.group === "Planning");
  assert.ok(planning);
  editTask(f.db, {
    ...f.input(),
    id: f.taskRecord.id,
    expectedRevision: f.taskRecord.revision,
    fields: {
      criteria: [
        { criterionId: f.criterion.id, contribution: "Implementation" },
        { criterionId: planning.id, contribution: "Planning" },
      ],
    },
  });
  assert.equal(getTaskDetail(f.db, f.swarmId, f.taskRecord.id).deferred, false);
});

test("SQL filters and vote context include ownership, author, group, archive and missing votes", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const filters = {
    mine: true,
    author: "Ann",
    criterionId: f.criterion.id,
    group: "Delivery",
    status: ["claimed"],
  } satisfies Parameters<typeof searchTaskCandidates>[3];
  assert.deepEqual(
    searchTaskCandidates(f.db, f.swarmId, "Ann", filters).map((task) => task.id),
    [task.id],
  );
  assert.deepEqual(searchTaskCandidates(f.db, f.swarmId, "Ben", filters), []);
  const criterionFilters = {
    group: "Delivery",
    author: "Ann",
    taskId: task.id,
    status: ["incomplete"],
    needsMyVote: true,
  } satisfies Parameters<typeof searchCriterionCandidates>[3];
  assert.deepEqual(
    searchCriterionCandidates(f.db, f.swarmId, "Ann", criterionFilters).map((criterion) => criterion.id),
    [f.criterion.id],
  );
  const firstPage = criterionVoteContext(f.db, f.swarmId, "Ann", 0, 1);
  assert.ok(firstPage.nextAfter);
  const context = criterionVoteContext(f.db, f.swarmId, "Ann", firstPage.nextAfter, 1);
  assert.equal(context.nextAfter, null);
  assert.equal(context.tasks[0]?.id, task.id);
  assert.equal(context.criteria[0]?.tasks[0]?.owner, "Ann");
  assert.ok(context.criteria[0]?.missingCovered.includes("Ann"));
  archiveCriterion(f.db, { ...f.input(), id: f.criterion.id });
  assert.deepEqual(searchCriterionCandidates(f.db, f.swarmId, "Ann", criterionFilters), []);
  assert.equal(
    searchCriterionCandidates(f.db, f.swarmId, "Ann", { ...criterionFilters, includeArchived: true }).length,
    1,
  );
});

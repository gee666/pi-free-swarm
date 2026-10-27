import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { createCriterion } from "../../src/broker/criteria.js";
import { claimTask } from "../../src/broker/task-ownership.js";
import { createTask, editTask } from "../../src/broker/tasks.js";
import { filteredCriterionCandidates, filteredTaskCandidates } from "../../src/store/work-search.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

let temp: TempDb;
let swarmId: number;
beforeEach(() => {
  temp = createTempDb();
  swarmId = seedSwarm(temp.db).id;
});
afterEach(() => temp.cleanup());
function criterion(title: string, now = T0) {
  return createCriterion(temp.db, {
    swarmId,
    actor: "User",
    now,
    title,
    group: "Search",
    body: "Body",
    verification: "Check",
    source: "",
  });
}
function task(criterionId: number, title: string) {
  return createTask(temp.db, {
    swarmId,
    actor: "User",
    now: T0,
    title,
    body: "Body",
    criteria: [{ criterionId, contribution: "Coverage" }],
  });
}
it("filters unowned tasks with SQL NULL semantics and still resolves named owners", () => {
  const linked = criterion("Ownership");
  const unowned = task(linked.id, "Unowned");
  const owned = task(linked.id, "Owned");
  claimTask(temp.db, { swarmId, actor: "Maria", now: T0, id: owned.id });
  assert.deepEqual(
    filteredTaskCandidates(temp.db, swarmId, "User", { owner: "unowned", criterionId: linked.id }).map(
      (item) => item.id,
    ),
    [unowned.id],
  );
  assert.deepEqual(
    filteredTaskCandidates(temp.db, swarmId, "User", { owner: "maria", criterionId: linked.id }).map((item) => item.id),
    [owned.id],
  );
});
it("sorts task and criterion candidates by update time, then descending ID", () => {
  const older = criterion("Older ID", T0 + 1);
  const newer = criterion("Newer ID", T0);
  const tie = criterion("Tie", T0);
  assert.deepEqual(
    filteredCriterionCandidates(temp.db, swarmId, "User", { group: "Search" }).map((item) => item.id),
    [older.id, tie.id, newer.id],
  );
  const first = task(older.id, "First");
  const second = task(older.id, "Second");
  const third = task(older.id, "Third");
  editTask(temp.db, {
    swarmId,
    actor: "User",
    now: T0 + 1,
    id: first.id,
    expectedRevision: first.revision,
    fields: { body: "Recent edit" },
  });
  assert.deepEqual(
    filteredTaskCandidates(temp.db, swarmId, "User", { criterionId: older.id }).map((item) => item.id),
    [first.id, third.id, second.id],
  );
});

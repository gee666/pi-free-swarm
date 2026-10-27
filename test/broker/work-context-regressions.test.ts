import assert from "node:assert/strict";
import { test } from "node:test";
import { criterionVoteContext } from "../../src/broker/work-queries.js";
import { insertCriterion } from "../../src/store/criteria.js";
import { insertTask, getTask, replaceTaskLinks, saveTask } from "../../src/store/tasks.js";
import { PAGE_MAX_COUNT } from "../../src/constants.js";
import { workFixture } from "../helpers/work-graph.js";

test("vote context pages hundreds of own tasks with their criteria and never returns full task bodies", (t) => {
  const f = workFixture(t);
  const expected: number[] = [];
  f.db.write(() => {
    for (let n = 0; n < 210; n++) {
      const id = insertCriterion(
        f.db,
        f.swarmId,
        { group: "Scale", title: `Requirement ${n}`, body: "Requirement", verification: "Test", source: "" },
        "Ann",
        f.input().now,
      );
      const taskId = insertTask(
        f.db,
        f.swarmId,
        { title: `Task ${n}`, body: "Large body ".repeat(20), author: "Ann" },
        f.input().now,
      );
      const task = getTask(f.db, f.swarmId, taskId);
      assert.ok(task);
      saveTask(f.db, { ...task, owner: "Ann", status: "claimed" });
      replaceTaskLinks(f.db, taskId, [{ criterionId: id, contribution: "Coverage" }]);
      expected.push(taskId);
    }
  });
  const seen: number[] = [];
  let after = 0;
  do {
    const page = criterionVoteContext(f.db, f.swarmId, "Ann", after, 5);
    assert.ok(page.tasks.length <= 5);
    assert.ok(JSON.stringify(page).length < 20_000);
    for (const task of page.tasks) {
      assert.deepEqual(Object.keys(task).sort(), ["id", "status", "title"]);
      assert.ok(page.criteria.some((criterion) => criterion.tasks.some((linked) => linked.id === task.id)));
      seen.push(task.id);
    }
    after = page.nextAfter ?? 0;
  } while (after);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, seen.length);
});

test("a criterion with hundreds of tasks has bounded summaries and explicit truncation", (t) => {
  const f = workFixture(t);
  f.db.write(() => {
    for (let n = 0; n <= PAGE_MAX_COUNT; n++) {
      const id = insertTask(
        f.db,
        f.swarmId,
        { title: "Task", body: "Do not repeat full bodies", author: "Ann" },
        f.input().now,
      );
      const task = getTask(f.db, f.swarmId, id);
      assert.ok(task);
      saveTask(f.db, { ...task, owner: "Ann", status: "claimed" });
      replaceTaskLinks(f.db, id, [{ criterionId: f.criterion.id, contribution: "Coverage" }]);
    }
  });
  const page = criterionVoteContext(f.db, f.swarmId, "Ann", f.criterion.id - 1, 1);
  assert.equal(page.tasks.length, PAGE_MAX_COUNT);
  assert.equal(page.tasksTruncated, true);
  assert.equal(page.criteria[0]?.tasks.length, PAGE_MAX_COUNT);
  assert.equal(page.criteria[0]?.taskCount, PAGE_MAX_COUNT + 1);
});

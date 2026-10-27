import assert from "node:assert/strict";
import { test } from "node:test";
import { editTask } from "../../src/broker/tasks.js";
import { createCriterion } from "../../src/broker/criteria.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { getTask, taskTimeline } from "../../src/store/tasks.js";
import { workFixture } from "../helpers/work-graph.js";

function messages(f: ReturnType<typeof workFixture>, after: number) {
  return f.db.sql
    .prepare(
      `SELECT m.body, r.name AS recipient FROM messages m JOIN message_recipients r ON r.message_id = m.id
    WHERE m.swarm_id = ? AND m.id > ? ORDER BY m.id`,
    )
    .all(f.swarmId, after);
}
function lastMessage(f: ReturnType<typeof workFixture>): number {
  return Number(f.db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages").get()?.id);
}

test("removing or replacing the last unfinished dependency wakes a claimed owner once; no-op edits do not", (t) => {
  const f = workFixture(t);
  const unfinished = f.task();
  const accepted = f.task();
  f.accept(accepted.id);
  for (const dependsOn of [[], [accepted.id]]) {
    const task = f.task(f.criterion.id, [unfinished.id], true);
    const after = lastMessage(f);
    const updated = editTask(f.db, {
      ...f.input(),
      id: task.id,
      expectedRevision: task.revision,
      fields: { dependsOn },
    });
    assert.equal(taskTimeline(f.db, task.id).filter((event) => event.kind === "dependencies_ready").length, 1);
    assert.deepEqual(
      messages(f, after).map((message) => message.recipient),
      ["Ann"],
    );
    assert.match(String(messages(f, after)[0]?.body), new RegExp(`Dependencies ready for task #${task.id}`));
    editTask(f.db, {
      ...f.input(),
      id: task.id,
      expectedRevision: updated.revision,
      fields: { dependsOn: [...dependsOn, ...dependsOn] },
    });
    assert.equal(messages(f, after).length, 1);
    assert.equal(taskTimeline(f.db, task.id).filter((event) => event.kind === "dependencies_ready").length, 1);
  }
});

test("unlinking the last open task coalesces stale and needed vote requests per recipient and criterion", (t) => {
  const f = workFixture(t);
  const accepted = f.task();
  f.accept(accepted.id);
  const open = f.task();
  const other = createCriterion(f.db, {
    ...f.input(),
    group: "Other",
    title: "More work",
    body: "Not done",
    verification: "Test",
    source: "",
  });
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "incomplete", reason: "Open task" });
  const after = lastMessage(f);
  const current = getTask(f.db, f.swarmId, open.id);
  assert.ok(current);
  editTask(f.db, {
    ...f.input(),
    id: open.id,
    expectedRevision: current.revision,
    fields: { criteria: [{ criterionId: other.id, contribution: "Other coverage" }] },
  });
  const notifications = messages(f, after);
  assert.deepEqual(notifications.map((message) => message.recipient).sort(), ["Ann", "Ben"]);
  for (const message of notifications) assert.match(String(message.body), /is stale.*swarm_criteria_vote/);
});

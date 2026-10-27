import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createCriterion, editCriterion } from "../../src/broker/criteria.js";
import { createTask, editTask } from "../../src/broker/tasks.js";
import { getTaskDetail } from "../../src/broker/work-queries.js";
import { updatePostLinks } from "../../src/broker/post-links.js";
import { createPost } from "../../src/broker/wall.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { workFixture } from "../helpers/work-graph.js";

test("agent limits count Unicode points and User long bodies are stored as preview plus file", (t) => {
  const f = workFixture(t);
  const fields = { group: "QA", title: "x".repeat(100), body: "🙂".repeat(300), verification: "Run tests", source: "" };
  const criterion = createCriterion(f.db, { ...f.input(), ...fields });
  assert.equal(criterion.body, fields.body);
  assert.throws(() => createCriterion(f.db, { ...f.input(), ...fields, title: "x".repeat(101) }), /too long/);
  assert.throws(
    () => createCriterion(f.db, { ...f.input(), ...fields, body: "🙂".repeat(301) }),
    /301 chars.*under 200.*file/,
  );
  assert.throws(() => createCriterion(f.db, { ...f.input("User"), ...fields, title: "x".repeat(101) }), /too long/);
  const body = "Long user request. ".repeat(100);
  const userCriterion = createCriterion(f.db, { ...f.input("User"), ...fields, body });
  const reference = userCriterion.body.match(/\[full text: (.+)\]$/u)?.[1];
  assert.ok(reference);
  assert.equal(readFileSync(path.join(f.cwd, reference), "utf8"), body.trim());
  const edited = editCriterion(f.db, {
    ...f.input(),
    id: userCriterion.id,
    expectedRevision: userCriterion.revision,
    fields: { title: "Clarify" },
  });
  assert.equal(edited.body, userCriterion.body, "editing another field preserves the User attachment");
});

test("cross-swarm graph references are rejected before mutation", (t) => {
  const f = workFixture(t);
  const other = seedSwarm(f.db, { agents: ["Ann", "Ben"] });
  const base = {
    ...f.input(),
    title: "Cross reference",
    body: "Not allowed",
    criteria: [{ criterionId: f.criterion.id, contribution: "Test" }],
  };
  assert.throws(() => createTask(f.db, { ...base, swarmId: other.id }), /not found in swarm/);
  const task = f.task();
  const otherPost = createPost(f.db, other.id, "Ann", { title: "Other", text: "Other swarm" }, f.input().now);
  assert.throws(() => updatePostLinks(f.db, { ...f.input(), postId: otherPost.id, taskIds: [task.id] }), /not found/);
  assert.throws(
    () => createTask(f.db, { ...base, swarmId: other.id, criteria: [], dependsOn: [task.id] }),
    /at least one/,
  );
});

test("failed edits roll back links and timeline with the revision unchanged", (t) => {
  const f = workFixture(t);
  const first = f.task();
  const second = f.task(f.criterion.id, [first.id]);
  const before = getTaskDetail(f.db, f.swarmId, first.id);
  assert.throws(
    () =>
      editTask(f.db, {
        ...f.input(),
        id: first.id,
        expectedRevision: first.revision,
        fields: {
          title: "Must roll back",
          criteria: [{ criterionId: f.criterion.id, contribution: "Changed" }],
          dependsOn: [second.id],
        },
      }),
    /cycle/,
  );
  assert.deepEqual(getTaskDetail(f.db, f.swarmId, first.id), before);
});

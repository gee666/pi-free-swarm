import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveCriterion, editCriterion, restoreCriterion } from "../../src/broker/criteria.js";
import { recordCriterionBlocker, decideCriterionBlocker } from "../../src/broker/blockers.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { getCriterion } from "../../src/store/criteria.js";
import { recentWorkActivity } from "../../src/store/work-dashboard.js";
import { createPost } from "../../src/broker/wall.js";
import { updatePostLinks } from "../../src/broker/post-links.js";
import { listPostLinks } from "../../src/store/post-links.js";
import { workFixture } from "../helpers/work-graph.js";

test("criterion audit keeps creator and editor distinct and records every mutation with actor/time", (t) => {
  const f = workFixture(t);
  const task = f.task(f.criterion.id, [], true);
  const edited = editCriterion(f.db, {
    ...f.input("Ben"),
    id: f.criterion.id,
    expectedRevision: f.criterion.revision,
    fields: { body: "Edited by Ben" },
  });
  assert.equal(edited.author, "Ann");
  assert.equal(edited.updatedBy, "Ben");
  archiveCriterion(f.db, { ...f.input("Cam"), id: f.criterion.id });
  restoreCriterion(f.db, { ...f.input("User"), id: f.criterion.id });
  recordCriterionBlocker(f.db, {
    ...f.input("Dan"),
    criterionId: f.criterion.id,
    reason: "No access",
    missing: "Credentials",
    attempted: "Checked",
    unblock: "Grant access",
  });
  for (const actor of ["Ann", "Ben"])
    voteCriterion(f.db, { ...f.input(actor), criterionId: f.criterion.id, verdict: "blocked", reason: "Confirmed" });
  decideCriterionBlocker(f.db, { ...f.input("User"), criterionId: f.criterion.id, decision: "approve" });
  const rows = f.db.sql
    .prepare("SELECT actor, kind, created_at FROM criterion_events WHERE criterion_id = ? ORDER BY id")
    .all(f.criterion.id);
  assert.deepEqual(
    rows.map((row) => [row.actor, row.kind]),
    [
      ["Ann", "created"],
      ["Ben", "edited"],
      ["Cam", "archived"],
      ["User", "restored"],
      ["Dan", "blocker_recorded"],
      ["Ann", "voted"],
      ["Ben", "voted"],
      ["User", "blocker_decided"],
    ],
  );
  assert.equal(getCriterion(f.db, f.swarmId, f.criterion.id)?.updatedBy, "User");
  const activity = recentWorkActivity(f.db, f.swarmId, 20);
  assert.equal(activity[0]?.kind, "blocker_decided");
  assert.ok(
    activity.some(
      (row) =>
        row.targetKind === "criterion" &&
        row.targetId === f.criterion.id &&
        row.kind === "edited" &&
        row.actor === "Ben",
    ),
  );
  assert.ok(activity.some((row) => row.targetKind === "task" && row.targetId === task.id));
  for (let n = 0; n < 25; n++)
    voteCriterion(f.db, {
      ...f.input("Ben"),
      criterionId: f.criterion.id,
      verdict: "blocked",
      reason: "Still blocked",
    });
  assert.equal(recentWorkActivity(f.db, f.swarmId, 20).length, 20);
  assert.ok(recentWorkActivity(f.db, f.swarmId, 20).every((row) => row.kind === "voted"));
});

test("post links store who linked each target and preserve attribution on an idempotent repeat", (t) => {
  const f = workFixture(t);
  const task = f.task();
  const post = createPost(f.db, f.swarmId, "Ann", { title: "Evidence", text: "Review" }, f.input().now);
  const input = f.input("Ben");
  updatePostLinks(f.db, { ...input, postId: post.id, taskIds: [task.id], criterionIds: [f.criterion.id] });
  const links = listPostLinks(f.db, post.id);
  assert.ok(links.every((link) => link.linkedBy === "Ben" && link.linkedAt === input.now));
  updatePostLinks(f.db, { ...f.input("Cam"), postId: post.id, taskIds: [task.id] });
  assert.deepEqual(listPostLinks(f.db, post.id), links);
});

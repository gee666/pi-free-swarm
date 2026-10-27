import assert from "node:assert/strict";
import { test } from "node:test";
import { voteCriterion } from "../../src/broker/votes.js";
import { assessCriterion } from "../../src/broker/criterion-status.js";
import { updateProjectIntent } from "../../src/broker/project.js";
import { archiveCriterion } from "../../src/broker/criteria.js";
import { updatePostLinks } from "../../src/broker/post-links.js";
import { createPost } from "../../src/broker/wall.js";
import { workFixture } from "../helpers/work-graph.js";

test("unlinked status takes precedence even if a vacuously current covered vote exists", (t) => {
  const f = workFixture(t);
  voteCriterion(f.db, {
    ...f.input(),
    criterionId: f.criterion.id,
    verdict: "covered",
    reason: "No linked work yet",
  });
  const state = assessCriterion(f.db, f.swarmId, f.criterion.id);
  assert.equal(state.status, "unlinked");
  assert.equal(state.votes[0]?.stale, false);
});

test("intent paths are references and are not limited to repo-relative files", (t) => {
  const f = workFixture(t);
  const project = updateProjectIntent(f.db, {
    ...f.input(),
    summary: "Intent is recorded.",
    path: "/workspace/intent.md",
  });
  assert.equal(project.intentPath, "/workspace/intent.md");
});

test("post links may reference archived criteria without restoring them", (t) => {
  const f = workFixture(t);
  archiveCriterion(f.db, { ...f.input(), id: f.criterion.id });
  const post = createPost(f.db, f.swarmId, "Ann", { title: "History", text: "Historical context" }, f.input().now);
  const result = updatePostLinks(f.db, { ...f.input(), postId: post.id, criterionIds: [f.criterion.id] });
  assert.equal(result.links[0]?.targetId, f.criterion.id);
  assert.ok(assessCriterion(f.db, f.swarmId, f.criterion.id).archivedAt);
});

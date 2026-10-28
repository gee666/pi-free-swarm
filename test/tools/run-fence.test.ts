import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { closeRunAdmission } from "../../src/broker/run-admission.js";
import { createPost } from "../../src/broker/wall.js";
import { workFixture } from "../helpers/work-graph.js";

test("stale and closing worker identities cannot write communication or run controls, while reads remain available", (t) => {
  const f = workFixture(t);
  const post = createPost(f.db, f.swarmId, "Ann", { title: "Discussion", text: "Read me" }, f.input().now);
  const snapshot = () =>
    ["posts", "comments", "messages", "post_links", "post_subscriptions"].map((table) =>
      f.db.sql.prepare(`SELECT * FROM ${table}`).all(),
    );
  const before = snapshot();
  for (const run of [999, 1]) {
    if (run === 1) closeRunAdmission(f.db, f.swarmId, run, process.pid);
    const tools = createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run, agentName: "Ann" });
    for (const mutate of [
      () => tools.postsCreate({ title: "Stale post", body: "Rejected" }),
      () => tools.postsComment({ post_id: post.id, body: "Rejected" }),
      () => tools.postsUnsubscribe({ post_id: post.id }),
      () => tools.postsLink({ post_id: post.id, criterion_ids: [f.criterion.id] }),
      () => tools.snooze(),
      () => tools.retire({ handoff: "Rejected" }),
    ])
      assert.throws(mutate, /run is closing\/ended/);
    assert.deepEqual(snapshot(), before);
    assert.match(tools.postsGet({ id: post.id }), /Read me/);
  }
});

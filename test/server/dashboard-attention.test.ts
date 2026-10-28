import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardResponse } from "../../src/api-types.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { setUserPostSubscription } from "../../src/broker/user-post-subscription.js";
import { markUserCommentsRead } from "../../src/broker/user-comment-read.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

test("dashboard combines claimed/in-progress and distinguishes mentions from subscription updates", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const db = board.temp.db;
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const url = `${board.base}/api/swarms/${swarm.id}/dashboard`;
  const dashboard = async () => (await getJson<DashboardResponse>(url)).body;
  for (const status of ["new", "claimed", "in_progress", "review", "accepted"]) {
    db.sql
      .prepare(
        `INSERT INTO tasks(swarm_id,title,body,status,owner,author,created_at,updated_at)
      VALUES (?,'Task','Work',?,'Maria','Main',?,?)`,
      )
      .run(swarm.id, status, T0, T0);
  }
  const post = createPost(db, swarm.id, "Maria", { title: "Question for @User", text: "@USER @User please check" }, T0);
  const comment = addComment(db, swarm.id, "John", post.id, "@user @User evidence", T0).comment;
  setUserPostSubscription(db, swarm.id, post.id, true, T0);
  addComment(db, swarm.id, "John", post.id, "Ordinary subscription update", T0);
  createPost(db, other.id, "Maria", { title: "Other", text: "@User not this swarm" }, T0);
  const before = await dashboard();
  assert.equal(before.counts.inProgress, 2);
  assert.equal(before.attention.userMentions, 2);
  assert.equal(before.attention.unreadUserUpdates, 3);
  setUserPostSubscription(db, swarm.id, post.id, false, T0);
  const unsubscribed = await dashboard();
  assert.equal(unsubscribed.attention.userMentions, 2);
  assert.equal(unsubscribed.attention.unreadUserUpdates, 2);
  markUserCommentsRead(db, swarm.id, post.id, [], T0);
  assert.equal((await dashboard()).attention.userMentions, 1);
  markUserCommentsRead(db, swarm.id, post.id, [comment.id], T0);
  assert.equal((await dashboard()).attention.userMentions, 0);
});

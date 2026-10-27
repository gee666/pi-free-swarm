import assert from "node:assert/strict";
import { after, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { markUserCommentsRead } from "../../src/broker/user-comment-read.js";
import { getUserPostAttention } from "../../src/broker/user-post-subscription.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { userUnreadSummary } from "../../src/store/user-unread.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

it("records User wall badges without creating private messages, while agents still receive comments", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Follow", text: "body" }, T0);
  const first = addComment(db, swarm.id, "Maria", post.id, "evidence", T0 + 1).comment;
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
  assert.equal(getUserPostAttention(db, swarm.id, post.id).userUnreadComments, 1);
  const second = addComment(db, swarm.id, "John", post.id, "more evidence", T0 + 2).comment;
  const recipients = db.sql.prepare("SELECT name FROM message_recipients WHERE swarm_id = ?").all(swarm.id);
  assert.deepEqual(
    recipients.map((row) => row.name),
    ["Maria"],
  );
  assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 2 });
  assert.equal(markUserCommentsRead(db, swarm.id, post.id, [first.id], T0 + 3).updated, 1);
  assert.equal(getUserPostAttention(db, swarm.id, post.id).userUnreadComments, 1);
  assert.equal(markUserCommentsRead(db, swarm.id, post.id, [first.id], T0 + 4).updated, 0);
  assert.equal(markUserCommentsRead(db, swarm.id, post.id, [second.id], T0 + 5).updated, 1);
  sendMessage(db, { swarmId: swarm.id, from: "Maria", to: "User", text: "A real private message", now: T0 + 6 });
  assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 1, comments: 0 });
});

it("preserves future-only subscriptions, self exclusion and bounded read snapshots", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Scope", text: "body" }, T0);
  const first = addComment(db, swarm.id, "Maria", post.id, "retained", T0 + 1).comment;
  setPostSubscription(db, swarm.id, "User", post.id, false, T0 + 2);
  addComment(db, swarm.id, "John", post.id, "not backfilled", T0 + 3);
  assert.equal(markUserCommentsRead(db, swarm.id, post.id, [first.id], T0 + 4).updated, 0);
  setPostSubscription(db, swarm.id, "User", post.id, true, T0 + 5);
  addComment(db, swarm.id, "User", post.id, "not my own notification", T0 + 6);
  const other = createPost(db, swarm.id, "User", { title: "Other", text: "body" }, T0 + 7);
  const outside = addComment(db, swarm.id, "Liam", other.id, "another post", T0 + 8).comment;
  assert.equal(markUserCommentsRead(db, swarm.id, post.id, [outside.id], T0 + 9).updated, 0);
  assert.equal(getUserPostAttention(db, swarm.id, post.id).userUnreadComments, 1);
  assert.equal(getUserPostAttention(db, swarm.id, other.id).userUnreadComments, 1);
});

it("rolls back wall attention with its comment", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Atomic", text: "body" }, T0);
  assert.throws(
    () =>
      db.write(() => {
        addComment(db, swarm.id, "Maria", post.id, "rollback", T0 + 1);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(getUserPostAttention(db, swarm.id, post.id).userUnreadComments, 0);
});

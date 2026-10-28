import assert from "node:assert/strict";
import { test } from "node:test";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { markUserCommentsRead } from "../../src/broker/user-comment-read.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";
import { userUnreadState, userUnreadSummary } from "../../src/store/user-unread.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("User attention follows subscribed comments and preserves opt-out/self rules", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Mine", text: "Subscribed by authorship." }, T0);
    const comment = addComment(db, swarm.id, "Maria", post.id, "new comment", T0).comment;
    addComment(db, swarm.id, "User", post.id, "no self-notification", T0);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
    const otherPost = createPost(db, swarm.id, "Maria", { title: "Joined", text: "Comment to subscribe." }, T0);
    addComment(db, swarm.id, "User", otherPost.id, "joining", T0);
    const followed = addComment(db, swarm.id, "Liam", otherPost.id, "followed discussion", T0).comment;
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 2 });
    setPostSubscription(db, swarm.id, "User", otherPost.id, false, T0);
    addComment(db, swarm.id, "User", otherPost.id, "stay opted out", T0);
    addComment(db, swarm.id, "John", otherPost.id, "not notified", T0);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
    assert.deepEqual(userUnreadState(db, swarm.id), { total: 1, summary: { messages: 0, comments: 1 } });
    assert.equal(
      markUserCommentsRead(db, swarm.id, otherPost.id, [followed.id], T0 + 2).updated,
      0,
      "an unsubscribed discussion cannot consume a stale visible-read request",
    );
    assert.deepEqual(markUserCommentsRead(db, swarm.id, post.id, [followed.id], T0 + 2), {
      updated: 0,
      userUnread: { messages: 0, comments: 1 },
      userSubscribed: true,
    });
    assert.deepEqual(markUserCommentsRead(db, swarm.id, post.id, [comment.id, comment.id], T0 + 3), {
      updated: 1,
      userUnread: { messages: 0, comments: 0 },
      userSubscribed: true,
    });
    const retained = db.sql.prepare(`SELECT read_at FROM user_comment_attention WHERE comment_id = ?`).get(followed.id);
    assert.equal(retained?.read_at, null, "hiding an unfollowed discussion never marks unseen content read");
    setPostSubscription(db, swarm.id, "User", otherPost.id, true, T0 + 4);
    const reopened = openSwarmDb(db.path, { create: false });
    try {
      assert.deepEqual(userUnreadSummary(reopened, swarm.id), { messages: 0, comments: 1 });
    } finally {
      reopened.close();
    }
  } finally {
    temp.cleanup();
  }
});

test("User wall attention survives unsubscribe without creating private notifications", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Cancelled", text: "Keep terminal delivery state." }, T0);
    const comment = addComment(db, swarm.id, "Maria", post.id, "old unsent", T0).comment;
    assert.equal(
      db.sql.prepare("SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = 'User'").get(swarm.id)
        ?.n,
      0,
    );
    setPostSubscription(db, swarm.id, "User", post.id, false, T0 + 1);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 0 });
    setPostSubscription(db, swarm.id, "User", post.id, true, T0 + 2);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
    assert.equal(markUserCommentsRead(db, swarm.id, post.id, [comment.id], T0 + 3).updated, 1);
    addComment(db, swarm.id, "John", post.id, "future only", T0 + 4);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
  } finally {
    temp.cleanup();
  }
});

test("visible comment IDs never sweep later arrivals, another post or another swarm", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const other = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Snapshot", text: "Read exact IDs." }, T0);
    const otherPost = createPost(db, other.id, "User", { title: "Other", text: "Isolated." }, T0);
    const seen = addComment(db, swarm.id, "Maria", post.id, "shown", T0).comment;
    const foreign = addComment(db, other.id, "Maria", otherPost.id, "not shown", T0).comment;
    const later = addComment(db, swarm.id, "John", post.id, "arrived after snapshot", T0 + 1).comment;
    assert.equal(markUserCommentsRead(db, swarm.id, post.id, [seen.id, foreign.id], T0 + 2).updated, 1);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
    assert.deepEqual(userUnreadSummary(db, other.id), { messages: 0, comments: 1 });
    assert.throws(() => markUserCommentsRead(db, other.id, post.id, [later.id], T0), /not found/);
    assert.throws(() => markUserCommentsRead(db, swarm.id, post.id, [-1], T0), /commentIds/);
    assert.throws(
      () =>
        db.write(() => {
          markUserCommentsRead(db, swarm.id, post.id, [later.id], T0);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
    assert.equal(markUserCommentsRead(db, swarm.id, post.id, [seen.id], T0).updated, 0);
    assert.equal(markUserCommentsRead(db, swarm.id, post.id, [later.id], T0).updated, 1);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 0 });
  } finally {
    temp.cleanup();
  }
});

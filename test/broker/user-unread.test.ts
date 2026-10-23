import assert from "node:assert/strict";
import { test } from "node:test";
import { markUserRead, sendMessage } from "../../src/broker/messages.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { markUserCommentsRead } from "../../src/broker/user-comment-read.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";
import { userUnreadState, userUnreadSummary } from "../../src/store/user-unread.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("User attention separates direct messages from subscribed comments and preserves opt-out/self rules", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Mine", text: "Subscribed by authorship." }, T0);
    const comment = addComment(db, swarm.id, "Maria", post.id, "new comment", T0).comment;
    const direct = sendMessage(db, swarm.id, "John", ["User"], "direct work", T0);
    addComment(db, swarm.id, "User", post.id, "no self-notification", T0);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 1, comments: 1 });
    const otherPost = createPost(db, swarm.id, "Maria", { title: "Joined", text: "Comment to subscribe." }, T0);
    addComment(db, swarm.id, "User", otherPost.id, "joining", T0);
    const followed = addComment(db, swarm.id, "Liam", otherPost.id, "followed discussion", T0).comment;
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 1, comments: 2 });
    setPostSubscription(db, swarm.id, "User", otherPost.id, false, T0);
    addComment(db, swarm.id, "User", otherPost.id, "stay opted out", T0);
    addComment(db, swarm.id, "John", otherPost.id, "not notified", T0);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 1, comments: 1 });
    assert.deepEqual(markUserRead(db, swarm.id, [direct.id], T0 + 1), { updated: 1, unread: 2 });
    assert.deepEqual(userUnreadState(db, swarm.id), { total: 2, summary: { messages: 0, comments: 1 } });
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
    const retained = db.sql
      .prepare(
        `SELECT r.status FROM message_recipients r JOIN comment_notifications n
      ON n.message_id = r.message_id WHERE n.comment_id = ? AND r.name = 'User'`,
      )
      .get(followed.id);
    assert.equal(retained?.status, "delivered", "hiding an unfollowed discussion never marks unseen content read");
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

test("cancelled unsent User notifications never return on resubscribe", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Cancelled", text: "Keep terminal delivery state." }, T0);
    const comment = addComment(db, swarm.id, "Maria", post.id, "old unsent", T0).comment;
    const notification = db.sql
      .prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?")
      .get(comment.id);
    assert.ok(notification && typeof notification.message_id === "number");
    db.sql
      .prepare(
        "UPDATE message_recipients SET status = 'pending', delivered_at = NULL WHERE message_id = ? AND name = 'User'",
      )
      .run(notification.message_id);
    setPostSubscription(db, swarm.id, "User", post.id, false, T0 + 1);
    setPostSubscription(db, swarm.id, "User", post.id, true, T0 + 2);
    assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 0 });
    assert.equal(markUserCommentsRead(db, swarm.id, post.id, [comment.id], T0 + 3).updated, 0);
    assert.equal(
      db.sql
        .prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'User'")
        .get(notification.message_id)?.status,
      "undeliverable",
    );
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

import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { addComment, createPost } from "../../src/broker/wall.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";

import { openSwarmDb } from "../../src/store/db.js";
import { getMessages } from "../../src/store/message-queries.js";

import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

it("subscribes authors/commenters once, excludes self and delivers actual comment text", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Evidence", text: "report" }, T0);
  const first = addComment(db, swarm.id, "John", post.id, "first evidence", T0 + 1).comment;
  addComment(db, swarm.id, "Liam", post.id, "second evidence", T0 + 2);
  const rows = db.sql
    .prepare(
      `SELECT m.body, r.name FROM messages m JOIN message_recipients r ON r.message_id = m.id WHERE m.swarm_id = ? ORDER BY m.id, r.name`,
    )
    .all(swarm.id);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Maria", "John", "Maria"],
  );
  assert.equal(rows[0].body, "first evidence");
  const notification = db.sql
    .prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?")
    .get(first.id);
  assert.ok(notification && typeof notification.message_id === "number");
  assert.equal(
    getMessages(db, [notification.message_id])[0].text,
    `Comment #${first.id} on post #${post.id} by John:\nfirst evidence`,
  );
});

it("preserves a maximum-length legal comment and its complete notification", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Large", text: "body" }, T0);
  const settingsPath = path.join(db.dataDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({}));
  const body = "x".repeat(300);
  const comment = addComment(db, swarm.id, "John", post.id, body, T0).comment;
  const row = db.sql.prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?").get(comment.id);
  assert.ok(row && typeof row.message_id === "number");
  assert.equal(
    getMessages(db, [row.message_id])[0].text,
    `Comment #${comment.id} on post #${post.id} by John:\n${body}`,
  );
  rmSync(settingsPath);
});

it("durable opt-out survives commenting; resubscription is future-only and isolates posts", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "One", text: "body" }, T0);
  const other = createPost(db, swarm.id, "Maria", { title: "Two", text: "body" }, T0);
  addComment(db, swarm.id, "John", post.id, "queued", T0 + 1);
  setPostSubscription(db, swarm.id, "Maria", post.id, false, T0 + 2);
  addComment(db, swarm.id, "Maria", post.id, "still opted out", T0 + 3);
  addComment(db, swarm.id, "Liam", post.id, "not notified", T0 + 4);
  addComment(db, swarm.id, "Liam", other.id, "other post", T0 + 5);
  const pending = () =>
    db.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = 'Maria' AND status = 'pending'",
      )
      .get(swarm.id)?.n;
  assert.equal(pending(), 1);
  setPostSubscription(db, swarm.id, "Maria", post.id, true, T0 + 6);
  assert.equal(pending(), 1);
  addComment(db, swarm.id, "John", post.id, "future", T0 + 7);
  assert.equal(pending(), 2);
});

it("retains offline notifications and explicit opt-out across a reopened database", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Restart", text: "body" }, T0);
  setPostSubscription(db, swarm.id, "Liam", post.id, false, T0);
  addComment(db, swarm.id, "John", post.id, "recover after restart", T0 + 1);
  const reopened = openSwarmDb(db.path, { create: false });
  try {
    assert.equal(
      reopened.sql.prepare("SELECT subscribed FROM post_subscriptions WHERE post_id = ? AND name = 'Liam'").get(post.id)
        ?.subscribed,
      0,
    );
    assert.equal(
      reopened.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = 'Maria' AND status = 'pending'",
        )
        .get(swarm.id)?.n,
      1,
    );
    addComment(reopened, swarm.id, "Liam", post.id, "does not resubscribe", T0 + 2);
    assert.equal(
      reopened.sql.prepare("SELECT subscribed FROM post_subscriptions WHERE post_id = ? AND name = 'Liam'").get(post.id)
        ?.subscribed,
      0,
    );
  } finally {
    reopened.close();
  }
});

it("rejects cross-swarm subscription and rolls subscription/notification writes back atomically", () => {
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Atomic", text: "body" }, T0);
  assert.throws(() => setPostSubscription(db, other.id, "Maria", post.id, true, T0), /not found/);
  assert.throws(
    () =>
      db.write(() => {
        addComment(db, swarm.id, "John", post.id, "rolled back", T0);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
});

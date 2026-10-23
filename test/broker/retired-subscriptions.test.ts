import assert from "node:assert/strict";
import { test } from "node:test";
import { addComment, createPost } from "../../src/broker/wall.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("retired subscribers retain history but receive no new comment notifications", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "Maria", { title: "Archived author", text: "Keep history." }, T0);
    const initial = addComment(db, swarm.id, "John", post.id, "pending before removal", T0).comment;
    const row = db.sql.prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?").get(initial.id);
    assert.ok(row && typeof row.message_id === "number");
    const oldId = row.message_id;
    db.sql
      .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'")
      .run(T0 + 1, swarm.id);
    addComment(db, swarm.id, "Liam", post.id, "only active subscribers", T0 + 2);
    assert.equal(
      db.sql.prepare("SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = 'Maria'").get(swarm.id)
        ?.n,
      1,
    );
    assert.equal(
      db.sql.prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'Maria'").get(oldId)
        ?.status,
      "pending",
    );
    assert.equal(
      db.sql.prepare("SELECT subscribed FROM post_subscriptions WHERE post_id = ? AND name = 'Maria'").get(post.id)
        ?.subscribed,
      1,
    );
  } finally {
    temp.cleanup();
  }
});

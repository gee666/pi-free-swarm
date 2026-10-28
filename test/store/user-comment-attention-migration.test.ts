import { removeWorkSchema } from "../helpers/legacy-work-schema.js";
import assert from "node:assert/strict";
import { it } from "node:test";
import { insertSystemNotice } from "../../src/broker/message-insert.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { SCHEMA_VERSION, openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

it("migrates historical User comment attention without deleting mailbox history or reopening read items", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "Maria", { title: "Legacy", text: "body" }, T0);
    const states = ["pending", "delivered", "read", "undeliverable"] as const;
    const comments = states.map((status, index) => {
      const comment = addComment(db, swarm.id, "Maria", post.id, `legacy ${status}`, T0 + index).comment;
      const notice = insertSystemNotice(db, {
        swarmId: swarm.id,
        recipient: "User",
        text: comment.text,
        commentSource: { postId: post.id, commentId: comment.id },
        now: T0 + index,
      });
      db.sql.prepare("UPDATE message_recipients SET status = ? WHERE message_id = ?").run(status, notice.id);
      return comment;
    });
    const before = db.sql.prepare("SELECT id, body FROM messages WHERE swarm_id = ? ORDER BY id").all(swarm.id);
    removeWorkSchema(db);
    db.sql.exec(
      "DROP TABLE user_comment_attention; DROP TABLE post_claims; DROP TABLE post_contracts; PRAGMA user_version = 14;",
    );
    const upgraded = openSwarmDb(db.path, { create: false });
    try {
      assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
      const attention = upgraded.sql
        .prepare("SELECT comment_id, swarm_id, post_id, read_at FROM user_comment_attention ORDER BY comment_id")
        .all();
      assert.deepEqual(
        attention.map((row) => ({ ...row })),
        comments.map((comment, index) => ({
          comment_id: comment.id,
          swarm_id: swarm.id,
          post_id: post.id,
          read_at: index < 2 ? null : 0,
        })),
      );
      assert.deepEqual(
        upgraded.sql.prepare("SELECT id, body FROM messages WHERE swarm_id = ? ORDER BY id").all(swarm.id),
        before,
      );
    } finally {
      upgraded.close();
    }
    const reopened = openSwarmDb(db.path, { create: false });
    try {
      assert.equal(reopened.sql.prepare("SELECT COUNT(*) AS n FROM user_comment_attention").get()?.n, 4);
    } finally {
      reopened.close();
    }
  } finally {
    temp.cleanup();
  }
});

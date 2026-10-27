import { removeWorkSchema } from "../helpers/legacy-work-schema.js";
import assert from "node:assert/strict";
import { it } from "node:test";
import { claimPostRole } from "../../src/broker/post-claims.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { SCHEMA_VERSION, openSwarmDb } from "../../src/store/db.js";
import { listPostClaims } from "../../src/store/post-claims.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

it("upgrades schema15 without losing wall attention and retains claims across reopen", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "User", { title: "Existing work", text: "source" }, T0);
    addComment(db, swarm.id, "Maria", post.id, "evidence", T0 + 1);
    const before = db.sql.prepare("SELECT * FROM user_comment_attention").all();
    removeWorkSchema(db);
    db.sql.exec("DROP TABLE post_claims; DROP TABLE post_contracts; PRAGMA user_version = 15;");
    const upgraded = openSwarmDb(db.path, { create: false });
    try {
      assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
      assert.deepEqual(upgraded.sql.prepare("SELECT * FROM user_comment_attention").all(), before);
      assert.deepEqual(listPostClaims(upgraded, swarm.id, post.id), []);
      claimPostRole(upgraded, swarm.id, "John", post.id, "source comparison", T0 + 2);
    } finally {
      upgraded.close();
    }
    const reopened = openSwarmDb(db.path, { create: false });
    try {
      assert.deepEqual(listPostClaims(reopened, swarm.id, post.id), [
        {
          postId: post.id,
          role: "source comparison",
          agent: "John",
          createdAt: T0 + 2,
        },
      ]);
      assert.deepEqual(reopened.sql.prepare("SELECT * FROM user_comment_attention").all(), before);
    } finally {
      reopened.close();
    }
  } finally {
    temp.cleanup();
  }
});

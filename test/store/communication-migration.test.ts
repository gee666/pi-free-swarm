import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import { inspectAcceptance } from "../../src/broker/acceptance.js";
import { initialWallCursor, readWallDeltaAs } from "../../src/broker/wall-delta.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";

it("upgrades released v1 without losing history, delivery state, foreign keys or sequence high-water marks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "swarm-migration-"));
  const file = path.join(dir, "swarm.db");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(readFileSync(new URL("../../src/store/schema.sql", import.meta.url), "utf8"));
    legacy.exec(`
      INSERT INTO swarms (id,name,task_prompt,agent_amount,status,created_at) VALUES (1,'old','task',1,'running',1);
      INSERT INTO participants (swarm_id,name,kind,status,launch_order,session_file) VALUES (1,'Maria','agent','working',0,'session.jsonl');
      INSERT INTO posts VALUES (8,1,'Maria','old post','historical body',1);
      INSERT INTO posts VALUES (99,1,'Maria','deleted','deleted',1);
      DELETE FROM posts WHERE id = 99;
      INSERT INTO comments VALUES (4,8,1,'Maria','historical comment',2);
      INSERT INTO threads VALUES (3,1,'Maria',1);
      INSERT INTO thread_members VALUES (3,'Maria',0);
      INSERT INTO messages VALUES (7,1,3,'Maria','historical message',2);
      INSERT INTO message_recipients VALUES (7,1,'Maria',0,'delivered',3,NULL);
      INSERT INTO read_marks VALUES (1,'Maria',8);
      PRAGMA user_version = 1;
    `);
    const tables = ["posts", "comments", "messages", "message_recipients", "thread_members", "read_marks"];
    const before = tables.map((table) => legacy.prepare(`SELECT * FROM ${table}`).all());
    legacy.close();
    const db = openSwarmDb(file, { create: false });
    try {
      assert.deepEqual(
        tables.map((table) => db.sql.prepare(`SELECT * FROM ${table}`).all()),
        before,
      );
      assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, 3);
      assert.equal(inspectAcceptance(db, 1).verdict, "unchecked");
      assert.equal(inspectAcceptance(db, 1).originalTask, "task");
      assert.equal(db.sql.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
      const delta = readWallDeltaAs(db, 1, "Maria", initialWallCursor(1));
      assert.deepEqual(
        delta.changes.map((change) => [change.kind, change.id]),
        [
          ["post", 8],
          ["comment", 4],
        ],
      );
      const post = createPost(db, 1, "Maria", { title: "long", text: "x".repeat(4000) }, 3);
      assert.equal(post.id, 100);
      assert.equal(addComment(db, 1, "Maria", 8, "x".repeat(4000), 3).comment.text.length, 4000);
      assert.throws(
        () =>
          db.sql
            .prepare("INSERT INTO comments (post_id,swarm_id,author,body,created_at) VALUES (999,1,'Maria','bad',3)")
            .run(),
        /FOREIGN KEY/,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

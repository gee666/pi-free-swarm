import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sendWatcherChat } from "../../src/broker/watcher-chat.js";
import { openSwarmDb, SCHEMA_VERSION, swarmDbPath } from "../../src/store/db.js";
import { watcherChatPostId } from "../../src/store/watcher-chat.js";

test("023 upgrades real v22 without changing wall history and persists chat across reopen", (t) => {
  mkdirSync("tmp", { recursive: true });
  const cwd = mkdtempSync(path.resolve("tmp/watcher-chat-migration-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const file = swarmDbPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const legacy = new DatabaseSync(file);
  const store = new URL("../../src/store/", import.meta.url);
  const numbered = readdirSync(store)
    .filter((name) => {
      const version = Number(/^(\d+)-/.exec(name)?.[1]);
      return version >= 4 && version <= 22;
    })
    .sort();
  try {
    for (const migration of ["schema.sql", "002-communication.sql", "acceptance.sql", ...numbered])
      legacy.exec(readFileSync(new URL(migration, store), "utf8"));
    legacy.exec(`
      INSERT INTO swarms(id, name, task_prompt, agent_amount, status, created_at)
        VALUES (1, 'old', 'brief', 1, 'stopped', 1);
      INSERT INTO participants(swarm_id, name, kind, status)
        VALUES (1, 'User', 'user', NULL), (1, 'System', 'system', NULL), (1, 'Watcher', 'agent', 'pending');
      INSERT INTO posts(id, swarm_id, author, title, body, created_at)
        VALUES (1, 1, 'User', 'Watcher chat', 'Unrelated history', 1);
      INSERT INTO comments(id, post_id, swarm_id, author, body, created_at)
        VALUES (1, 1, 1, 'Watcher', 'Historical comment', 2);
      PRAGMA user_version = 22;
    `);
  } finally {
    legacy.close();
  }
  const db = openSwarmDb(file, { create: false });
  let postId: number;
  try {
    assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    assert.equal(db.sql.prepare("SELECT body FROM posts WHERE id = 1").get()?.body, "Unrelated history");
    assert.equal(db.sql.prepare("SELECT body FROM comments WHERE id = 1").get()?.body, "Historical comment");
    assert.equal(watcherChatPostId(db, 1), undefined);
    postId = sendWatcherChat(db, 1, "New question", 3);
    assert.notEqual(postId, 1);
    assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
  const reopened = openSwarmDb(file, { create: false });
  try {
    assert.equal(watcherChatPostId(reopened, 1), postId);
    assert.equal(sendWatcherChat(reopened, 1, "Follow-up", 4), postId);
    assert.equal(reopened.sql.prepare("SELECT COUNT(*) AS n FROM posts").get()?.n, 2);
  } finally {
    reopened.close();
  }
});

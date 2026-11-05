import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openSwarmDb, SCHEMA_VERSION, swarmDbPath } from "../../src/store/db.js";
import { appendWatcherChat, createWatcherChat, readWatcherChat } from "../../src/store/watcher-chat.js";

test("024 leaves historical wall-backed 023 chat untouched and persists a separate private transcript", (t) => {
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
      return version >= 4 && version <= 23;
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
        VALUES (1, 1, 'User', 'Watcher chat', '@Watcher historical question', 1);
      INSERT INTO comments(id, post_id, swarm_id, author, body, created_at)
        VALUES (1, 1, 1, 'Watcher', 'Historical comment', 2);
      INSERT INTO watcher_chats(swarm_id, post_id) VALUES (1, 1);
      PRAGMA user_version = 23;
    `);
  } finally {
    legacy.close();
  }
  const db = openSwarmDb(file, { create: false });
  try {
    assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    assert.deepEqual(readWatcherChat(db, 1), { sessionId: null, messages: [], status: "idle", error: null });
    createWatcherChat(db, 1, "private-id", 3);
    appendWatcherChat(db, 1, "private-id", "user", "Private question", 4);
    appendWatcherChat(db, 1, "private-id", "assistant", "Private answer", 5);
    createWatcherChat(db, 1, "fresh-id", 6);
    appendWatcherChat(db, 1, "private-id", "assistant", "Late old answer", 7);
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM watcher_chat_messages").get()?.n, 2);
    assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
  const reopened = openSwarmDb(file, { create: false });
  try {
    assert.equal(readWatcherChat(reopened, 1).sessionId, "fresh-id");
    assert.deepEqual(readWatcherChat(reopened, 1).messages, []);
    assert.equal(
      reopened.sql.prepare("SELECT body FROM posts WHERE id = 1").get()?.body,
      "@Watcher historical question",
    );
    assert.equal(reopened.sql.prepare("SELECT body FROM comments WHERE id = 1").get()?.body, "Historical comment");
    assert.equal(reopened.sql.prepare("SELECT post_id FROM watcher_chats WHERE swarm_id = 1").get()?.post_id, 1);
    assert.equal(reopened.sql.prepare("SELECT COUNT(*) AS n FROM posts").get()?.n, 1);
  } finally {
    reopened.close();
  }
});

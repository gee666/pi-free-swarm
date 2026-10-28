import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openSwarmDb, SCHEMA_VERSION, swarmDbPath } from "../../src/store/db.js";

test("020 upgrades populated 019 without changing task history, references or ID sequences", () => {
  mkdirSync("tmp", { recursive: true });
  const cwd = mkdtempSync(path.resolve("tmp/review-migration-"));
  const file = swarmDbPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const old = new DatabaseSync(file);
  const store = new URL("../../src/store/", import.meta.url);
  try {
    const numbered = readdirSync(store)
      .filter((name) => {
        const version = Number(/^(\d+)-/.exec(name)?.[1]);
        return version >= 4 && version <= 19;
      })
      .sort();
    for (const migration of ["schema.sql", "002-communication.sql", "acceptance.sql", ...numbered])
      old.exec(readFileSync(new URL(migration, store), "utf8"));
    old.exec(`
      INSERT INTO swarms(id, name, task_prompt, agent_amount, status, created_at) VALUES (1, 'old', 'brief', 1, 'stopped', 1);
      INSERT INTO participants(swarm_id, name, kind, status) VALUES (1, 'Owner', 'agent', 'stopped'), (1, 'Peer', 'agent', 'stopped');
      INSERT INTO criteria(id, swarm_id, group_name, title, body, verification, author, updated_by, created_at, updated_at)
        VALUES (1, 1, 'Delivery', 'Works', 'Works correctly', 'Run tests', 'Owner', 'Owner', 1, 1);
      INSERT INTO tasks(id, swarm_id, title, body, status, owner, author, created_at, updated_at, accepted_at, accepted_by)
        VALUES (1, 1, 'Done', 'Implementation', 'accepted', 'Owner', 'Owner', 1, 1, 2, 'Peer'),
               (2, 1, 'Pending review', 'Check implementation', 'review', 'Owner', 'Owner', 1, 1, NULL, NULL),
               (999, 1, 'Deleted', 'Old task', 'new', NULL, 'Owner', 1, 1, NULL, NULL);
      DELETE FROM tasks WHERE id = 999;
      INSERT INTO task_criteria VALUES (1, 1, 'Implementation'), (2, 1, 'Tests');
      INSERT INTO task_dependencies VALUES (2, 1);
      INSERT INTO task_events(id, swarm_id, task_id, actor, kind, evidence, reviewer, created_at)
        VALUES (1, 1, 2, 'Owner', 'review_requested', 'Original evidence', 'Peer', 1);
      PRAGMA user_version = 19;
    `);
  } finally {
    old.close();
  }
  const db = openSwarmDb(file, { create: false });
  try {
    assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    assert.equal(db.sql.prepare("SELECT accepted_by FROM tasks WHERE id = 1").get()?.accepted_by, "Peer");
    assert.equal(db.sql.prepare("SELECT evidence FROM task_events WHERE id = 1").get()?.evidence, "Original evidence");
    assert.equal(db.sql.prepare("SELECT count(*) AS n FROM task_dependencies").get()?.n, 1);
    assert.equal(db.sql.prepare("SELECT count(*) AS n FROM task_criteria").get()?.n, 2);
    assert.ok(
      !db.sql
        .prepare("PRAGMA table_info(task_events)")
        .all()
        .some((row) => row.name === "reviewer"),
    );
    db.sql.prepare("UPDATE tasks SET accepted_by = 'Owner review' WHERE id = 1").run();
    assert.throws(() => db.sql.prepare("UPDATE tasks SET owner = 'Ghost' WHERE id = 1").run(), /FOREIGN KEY/);
    assert.throws(() => db.sql.prepare("INSERT INTO task_criteria VALUES (2, 999, 'missing')").run(), /swarm/);
    const next = db.sql
      .prepare(
        `INSERT INTO tasks(swarm_id, title, body, status, author, created_at, updated_at)
      VALUES (1, 'New', 'Next task', 'new', 'Owner', 1, 1)`,
      )
      .run();
    assert.equal(Number(next.lastInsertRowid), 1000);
    assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

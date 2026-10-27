import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { ensureWorkGraphInitialized, readProject } from "../../src/broker/project.js";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { test } from "node:test";
import { openSwarmDb, SCHEMA_VERSION } from "../../src/store/db.js";
import { createPost, addComment } from "../../src/broker/wall.js";
import { sendMessage } from "../../src/broker/messages.js";
import { listCriteria } from "../../src/store/criteria.js";
import { listTasks } from "../../src/store/tasks.js";
import { removeWorkSchema } from "../helpers/legacy-work-schema.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("work graph migrates populated v17, preserving communication and dropping removed features", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "Maria", { title: "History", text: "Evidence" }, T0);
    addComment(db, swarm.id, "John", post.id, "Reviewed", T0);
    sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: "Keep this", now: T0 });
    const tables = ["posts", "comments", "messages", "message_recipients"];
    const before = tables.map((table) => db.sql.prepare(`SELECT * FROM ${table}`).all());
    removeWorkSchema(db);
    db.sql.prepare("INSERT INTO post_claims VALUES (?, ?, 'implementation', 'Maria', ?)").run(swarm.id, post.id, T0);
    db.sql
      .prepare("INSERT INTO post_contracts VALUES (?, ?, 1, 'docs/interface.md', 'Maria', ?)")
      .run(swarm.id, post.id, T0);
    db.sql
      .prepare("INSERT INTO acceptance_votes VALUES (?, 'Maria', 1, 'accepted', 'Historical vote', ?)")
      .run(swarm.id, T0);
    db.sql.prepare("UPDATE acceptance SET closed_run = 1 WHERE swarm_id = ?").run(swarm.id);
    db.sql
      .prepare("UPDATE swarms SET acceptance_criteria = ? WHERE id = ?")
      .run(JSON.stringify(["Must preserve this requirement", "Keep Unicode 😀"]), swarm.id);
    db.sql.exec("PRAGMA user_version = 17");
    const upgraded = openSwarmDb(db.path, { create: false });
    try {
      assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
      assert.deepEqual(
        tables.map((table) => upgraded.sql.prepare(`SELECT * FROM ${table}`).all()),
        before,
      );
      assert.deepEqual(upgraded.sql.prepare("PRAGMA foreign_key_check").all(), []);
      for (const table of [
        "acceptance",
        "acceptance_votes",
        "post_claims",
        "post_contracts",
        "read_marks",
        "post_coverage",
        "comment_coverage",
        "replacement_post_baselines",
        "wall_changes",
      ])
        assert.equal(upgraded.sql.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), undefined);
      assert.deepEqual(listTasks(upgraded, swarm.id), []);
      assert.deepEqual(
        listCriteria(upgraded, swarm.id).map((criterion) => [criterion.group, criterion.author, criterion.body]),
        [
          ["Main", "Main", "Must preserve this requirement"],
          ["Main", "Main", "Keep Unicode 😀"],
        ],
      );
      assert.equal(upgraded.sql.prepare("SELECT admission_closed_run FROM swarms").get()?.admission_closed_run, 1);
      assert.equal(evaluateCompletion(upgraded, swarm.id).done, false);
      endRun(upgraded, swarm.id, process.pid, "stopped", T0 + 2);
      beginResume(upgraded, swarm.id, process.pid, T0 + 3);
      const project = readProject(upgraded, swarm.id);
      assert.ok(project.briefPath);
      assert.equal(readFileSync(path.join(temp.cwd, project.briefPath), "utf8"), swarm.taskPrompt);
      assert.equal(listCriteria(upgraded, swarm.id).length, 3);
      assert.equal(listTasks(upgraded, swarm.id).length, 2);
      const events = upgraded.sql.prepare("SELECT count(*) AS n FROM events").get();
      ensureWorkGraphInitialized(upgraded, swarm.id, T0 + 4);
      assert.equal(listCriteria(upgraded, swarm.id).length, 3);
      assert.equal(listTasks(upgraded, swarm.id).length, 2);
      assert.deepEqual(upgraded.sql.prepare("SELECT count(*) AS n FROM events").get(), events);
    } finally {
      upgraded.close();
    }
  } finally {
    temp.cleanup();
  }
});

test("fresh graph enforces enums, foreign keys and same-swarm links", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const other = seedSwarm(db);
    const task = listTasks(db, swarm.id)[0];
    const criterion = listCriteria(db, other.id)[0];
    assert.ok(task && criterion);
    assert.equal(task.contentRevision, 1);
    for (const verdict of ["satisfied", "incomplete"])
      assert.throws(
        () =>
          db.sql
            .prepare(
              `INSERT INTO criterion_votes
        (criterion_id, voter, verdict, reason, criterion_revision, links_signature, created_at)
        VALUES (?, 'User', ?, 'Old verdict', 1, '', ?)`,
            )
            .run(criterion.id, verdict, T0),
        /CHECK/,
      );
    assert.throws(() => db.sql.prepare("UPDATE tasks SET status = 'waiting' WHERE id = ?").run(task.id), /CHECK/);
    assert.throws(() => db.sql.prepare("UPDATE swarms SET outcome = 'paused' WHERE id = ?").run(swarm.id), /CHECK/);
    assert.throws(
      () => db.sql.prepare("INSERT INTO task_criteria VALUES (?, ?, 'test')").run(task.id, criterion.id),
      /swarm/,
    );
    assert.throws(() => db.sql.prepare("INSERT INTO task_dependencies VALUES (?, ?)").run(task.id, task.id), /CHECK/);
    assert.throws(() => db.sql.prepare("UPDATE tasks SET owner = 'Ghost' WHERE id = ?").run(task.id), /FOREIGN KEY/);
    assert.throws(() => db.sql.prepare("INSERT INTO post_links VALUES (999, 'task', ?)").run(task.id));
    assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    temp.cleanup();
  }
});

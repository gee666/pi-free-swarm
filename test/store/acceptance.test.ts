import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, it } from "node:test";
import { getAcceptance } from "../../src/store/acceptance-queries.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

it("migrates legacy claims and verdicts into empty votes without losing run seals or revisions", () => {
  const legacyPath = path.join(temp.cwd, "legacy.db");
  const legacy = new DatabaseSync(legacyPath);
  try {
    for (const file of ["schema.sql", "002-communication.sql", "acceptance.sql"]) {
      legacy.exec(readFileSync(new URL(`../../src/store/${file}`, import.meta.url), "utf8"));
    }
    legacy.exec(`
      PRAGMA user_version = 3;
      INSERT INTO swarms (id, name, task_prompt, agent_amount, status, created_at)
        VALUES (1, 'checking', 'Original task', 1, 'starting', 0),
               (2, 'accepted', 'Finished task', 1, 'finished', 0);
      INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (1, 1, 0), (2, 1, 0);
      INSERT INTO participants (swarm_id, name, kind, status)
        VALUES (1, 'Maria', 'agent', 'working'), (2, 'John', 'agent', 'stopped');
      UPDATE acceptance SET revision = 5, verdict = 'checking', claimant = 'Maria',
        claim_run = 1, updated_by = 'Maria', updated_at = 42 WHERE swarm_id = 1;
      UPDATE acceptance SET revision = 8, verdict = 'accepted', closed_run = 1,
        evidence = '[{"reference":"old.log","result":"passed"}]' WHERE swarm_id = 2;
    `);
  } finally {
    legacy.close();
  }
  const migrated = openSwarmDb(legacyPath, { create: false });
  try {
    assert.equal(migrated.sql.prepare("PRAGMA user_version").get()?.user_version, 14);
    assert.deepEqual(migrated.sql.prepare("PRAGMA foreign_key_check").all(), []);
    const checking = getAcceptance(migrated, 1);
    assert.equal(checking.originalTask, "Original task");
    assert.deepEqual(checking.acceptanceCriteria, []);
    assert.equal(checking.revision, 5);
    assert.equal(checking.updatedBy, "Maria");
    assert.equal(checking.updatedAt, 42);
    assert.equal(checking.verdict, "unchecked");
    assert.deepEqual(checking.votes, []);
    assert.equal(getAcceptance(migrated, 2).verdict, "unchecked");
    assert.equal(getAcceptance(migrated, 2).revision, 8);
    assert.equal(migrated.sql.prepare("SELECT closed_run FROM acceptance WHERE swarm_id = 2").get()?.closed_run, 1);
    const columns = migrated.sql
      .prepare("PRAGMA table_info(acceptance)")
      .all()
      .map((row) => row.name);
    for (const obsolete of ["claimant", "claim_run", "verdict", "evidence", "known_gaps", "findings"]) {
      assert.equal(columns.includes(obsolete), false);
    }
    assert.equal(
      migrated.sql.prepare("SELECT name FROM sqlite_master WHERE name = 'acceptance_notifications'").get(),
      undefined,
    );
    migrated.sql.exec(
      "INSERT INTO swarms (id, name, task_prompt, agent_amount, status, created_at) VALUES (3, 'new', 'New task', 0, 'starting', 0)",
    );
    assert.equal(getAcceptance(migrated, 3).verdict, "unchecked");
  } finally {
    migrated.close();
  }
});

it("enforces per-agent uniqueness, vote verdicts, reasons and participant/run references", () => {
  const { id } = seedSwarm(db);
  const insert = db.sql.prepare(
    "INSERT INTO acceptance_votes (swarm_id, agent, run, verdict, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run(id, "Maria", 1, "accepted", "Done", T0);
  assert.throws(() => insert.run(id, "maria", 1, "blocked", "No access", T0), /UNIQUE/);
  assert.throws(() => insert.run(id, "John", 1, "checking", "Checking", T0), /CHECK/);
  assert.throws(() => insert.run(id, "John", 1, "accepted", " ", T0), /CHECK/);
  assert.throws(() => insert.run(id, "Ghost", 1, "accepted", "Done", T0), /FOREIGN KEY/);
  assert.throws(() => insert.run(id, "John", 2, "accepted", "Done", T0), /FOREIGN KEY/);
});

it("validates stored criteria and leaves free-form reasons unstructured", () => {
  const { id } = seedSwarm(db);
  db.sql.prepare("UPDATE swarms SET acceptance_criteria = ? WHERE id = ?").run('{"bad":"shape"}', id);
  assert.throws(() => getAcceptance(db, id), /Invalid acceptance criteria/);
  db.sql.prepare("UPDATE swarms SET acceptance_criteria = ? WHERE id = ?").run('["One criterion"]', id);
  db.sql
    .prepare(
      "INSERT INTO acceptance_votes (swarm_id, agent, run, verdict, reason, updated_at) VALUES (?, 'Maria', 1, 'accepted', ?, ?)",
    )
    .run(id, "Looked at it. No artifact or criterion assessment supplied.", T0);
  const record = getAcceptance(db, id);
  assert.deepEqual(record.acceptanceCriteria, ["One criterion"]);
  assert.equal(record.votes[0]?.reason, "Looked at it. No artifact or criterion assessment supplied.");
});

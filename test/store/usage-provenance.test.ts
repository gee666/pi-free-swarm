import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openSwarmDb } from "../../src/store/db.js";
import { agentUsageTotals } from "../../src/store/stats-queries.js";

// Build the actual pre-provenance schema, rather than lowering a modern DB's version number.
function legacyFixture() {
  mkdirSync("tmp", { recursive: true });
  const dir = mkdtempSync(path.resolve("tmp/usage-v13-"));
  const file = path.join(dir, "swarm.db");
  const sql = new DatabaseSync(file);
  for (const migration of [
    "schema.sql",
    "002-communication.sql",
    "acceptance.sql",
    "004-acceptance-votes.sql",
    "005-event-retention.sql",
    "006-wall-coverage.sql",
    "007-run-configuration.sql",
    "008-subscriptions.sql",
    "009-budget.sql",
    "010-budget-accounting.sql",
    "011-reminder-snooze.sql",
    "012-runtime-configuration.sql",
    "013-usage-cost-breakdown.sql",
  ]) {
    sql.exec(readFileSync(new URL(`../../src/store/${migration}`, import.meta.url), "utf8"));
  }
  sql.exec(
    "PRAGMA user_version = 13; INSERT INTO swarms(id,name,task_prompt,agent_amount,status,created_at,run_count) VALUES(1,'legacy','task',1,'stopped',1,3);",
  );
  let closed = false;
  return {
    file,
    sql,
    close() {
      if (!closed) {
        sql.close();
        closed = true;
      }
    },
    cleanup() {
      if (!closed) sql.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const insert = `INSERT INTO usage(id,swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at,cost_input,cost_output,cost_cache_read,cost_cache_write)
  VALUES(?,1,?,3,'message',10,20,30,40,?,'old-model',100,1,1,0,1)`;
const nativeInsert = `INSERT INTO usage(swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at,cost_reported)
  VALUES(1,?,3,?,0,0,0,0,?,NULL,101,?)`;

test("v14 preserves usage records, high-water IDs, indexes and known category amounts", () => {
  const legacy = legacyFixture();
  try {
    legacy.sql.prepare(insert).run(1, "Legacy", 3);
    legacy.sql.prepare(insert).run(2, "Zero", 0);
    legacy.sql.prepare(insert).run(3, "Negative", -1);
    legacy.sql.prepare(insert).run(999, "Legacy", 3);
    legacy.sql.exec("DELETE FROM usage WHERE id = 999;");
    assert.throws(
      () =>
        legacy.sql.exec(
          "INSERT INTO usage(swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,created_at) VALUES(1,'Legacy',3,'tool',0,0,0,0,1,100)",
        ),
      /CHECK/,
    );
    const columns =
      "id,swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at,cost_input,cost_output,cost_cache_read,cost_cache_write";
    const before = legacy.sql.prepare(`SELECT ${columns} FROM usage ORDER BY id`).all();
    legacy.close();
    const db = openSwarmDb(legacy.file, { create: false });
    try {
      assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, 17);
      assert.deepEqual(db.sql.prepare(`SELECT ${columns} FROM usage ORDER BY id`).all(), before);
      assert.deepEqual(
        db.sql
          .prepare("SELECT cost_reported FROM usage ORDER BY id")
          .all()
          .map((row) => row.cost_reported),
        [1, null, null],
      );
      assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = 1").get()?.n, 2);
      const first = db.sql.prepare(nativeInsert).run("Legacy", "tool", 0.25, 1);
      assert.equal(first.lastInsertRowid, 1000);
      db.sql.prepare(nativeInsert).run("Legacy", "usage", 0.5, 1);
      assert.equal(agentUsageTotals(db, 1, "Legacy").turns, 1);
      assert.equal(agentUsageTotals(db, 1, "Legacy").cost, 3.75);
      assert.equal(agentUsageTotals(db, 1, "Legacy").costBreakdown?.records, 3);
      const indexes = db.sql
        .prepare("PRAGMA index_list(usage)")
        .all()
        .map((row) => row.name);
      assert.ok(indexes.includes("usage_by_agent") && indexes.includes("usage_unverified_cost"));
      assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      db.close();
    }
  } finally {
    legacy.cleanup();
  }
});

test("the usage high-water mark survives when every old row was deleted", () => {
  const legacy = legacyFixture();
  try {
    legacy.sql.prepare(insert).run(77, "Legacy", 3);
    legacy.sql.exec("DELETE FROM usage;");
    legacy.close();
    const db = openSwarmDb(legacy.file, { create: false });
    try {
      assert.equal(db.sql.prepare(nativeInsert).run("Legacy", "usage", 0, 1).lastInsertRowid, 78);
    } finally {
      db.close();
    }
  } finally {
    legacy.cleanup();
  }
});

test("provenance gaps are atomic, deduplicated and compatible with old positive-cost writers", () => {
  const legacy = legacyFixture();
  legacy.close();
  try {
    const db = openSwarmDb(legacy.file, { create: false });
    try {
      const gaps = (agent: string) =>
        db.sql.prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = 1 AND agent = ?").get(agent)
          ?.n;
      db.sql.prepare(nativeInsert).run("OldPositive", "message", 0.25, null);
      assert.equal(gaps("OldPositive"), 0);
      db.sql.prepare(nativeInsert).run("KnownZero", "tool", 0, 1);
      assert.equal(gaps("KnownZero"), 0);
      db.sql.prepare(nativeInsert).run("OldZero", "message", 0, null);
      db.sql.prepare(nativeInsert).run("OldZero", "message", 0, null);
      assert.equal(gaps("OldZero"), 1);
      db.sql.prepare(nativeInsert).run("Missing", "tool", 0, 0);
      db.sql.prepare(nativeInsert).run("Missing", "usage", 0, 0);
      assert.equal(gaps("Missing"), 1);
      assert.throws(
        () =>
          db.write(() => {
            db.sql.prepare(nativeInsert).run("Rollback", "tool", 0, 0);
            throw new Error("rollback");
          }),
        /rollback/,
      );
      assert.equal(gaps("Rollback"), 0);
      assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage WHERE agent = 'Rollback'").get()?.n, 0);
    } finally {
      db.close();
    }
  } finally {
    legacy.cleanup();
  }
});

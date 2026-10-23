import assert from "node:assert/strict";
import { test } from "node:test";
import { recordUsage } from "../../src/broker/agent-state.js";
import { createAgentHooks } from "../../src/broker/agent-hooks.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { hasBudgetAccountingGap } from "../../src/store/budget.js";
import { openSwarmDb } from "../../src/store/db.js";
import { agentUsageTotals, getStats } from "../../src/store/stats-queries.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const legacy = { kind: "message", input: 2, output: 3, cacheRead: 5, cacheWrite: 7, cost: 2, model: null } as const;

test("category totals include compactions and disclose incomplete historical coverage", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    recordUsage(
      db,
      swarm.id,
      "Maria",
      { ...legacy, cost: 10, costBreakdown: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
      T0,
    );
    recordUsage(
      db,
      swarm.id,
      "Maria",
      { ...legacy, kind: "compaction", cost: 18, costBreakdown: { input: 5, output: 6, cacheRead: 0, cacheWrite: 7 } },
      T0 + 1,
    );
    recordUsage(db, swarm.id, "Maria", legacy, T0 + 2);
    const totals = agentUsageTotals(db, swarm.id, "Maria");
    assert.equal(totals.cost, 30);
    assert.equal(totals.turns, 2);
    assert.equal(totals.cacheRead, 15);
    assert.equal(totals.cacheWrite, 21);
    assert.deepEqual(totals.costBreakdown, {
      records: 3,
      input: { usd: 6, knownRecords: 2 },
      output: { usd: 8, knownRecords: 2 },
      cacheRead: { usd: 3, knownRecords: 2 },
      cacheWrite: { usd: 11, knownRecords: 2 },
    });
    assert.deepEqual(getStats(db, swarm.id, T0 + 3)?.totals.costBreakdown, totals.costBreakdown);
  } finally {
    temp.cleanup();
  }
});

test("zero reported categories differ from unknown categories and do not invalidate total-cost accounting", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const hooks = createAgentHooks({
      db,
      swarmId: swarm.id,
      run: 1,
      name: "Maria",
      clock: new FakeClock(T0),
      isEnding: () => false,
      onCrash() {},
    });
    hooks.onUsage({ ...legacy, cost: 7, costBreakdown: { input: 0, output: null, cacheRead: null, cacheWrite: 0 } });
    assert.equal(hasBudgetAccountingGap(db, swarm.id), false);
    assert.deepEqual(agentUsageTotals(db, swarm.id, "Maria").costBreakdown, {
      records: 1,
      input: { usd: 0, knownRecords: 1 },
      output: { usd: null, knownRecords: 0 },
      cacheRead: { usd: null, knownRecords: 0 },
      cacheWrite: { usd: 0, knownRecords: 1 },
    });
    assert.equal(agentUsageTotals(db, swarm.id, "Maria").cost, 7);
  } finally {
    temp.cleanup();
  }
});

test("v12 migration preserves old totals without inventing category prices", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    recordUsage(temp.db, swarm.id, "Maria", legacy, T0);
    temp.db.sql.exec(
      "ALTER TABLE usage DROP COLUMN cost_input; ALTER TABLE usage DROP COLUMN cost_output; ALTER TABLE usage DROP COLUMN cost_cache_read; ALTER TABLE usage DROP COLUMN cost_cache_write; PRAGMA user_version = 12;",
    );
    const upgraded = openSwarmDb(temp.db.path, { create: false });
    try {
      assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, 13);
      assert.deepEqual(agentUsageTotals(upgraded, swarm.id, "Maria"), {
        input: 2,
        output: 3,
        cacheRead: 5,
        cacheWrite: 7,
        cost: 2,
        turns: 1,
      });
      const row = upgraded.sql
        .prepare("SELECT cost_input,cost_output,cost_cache_read,cost_cache_write FROM usage WHERE swarm_id = ?")
        .get(swarm.id);
      assert.ok(row);
      assert.ok(Object.values(row).every((value) => value === null));
    } finally {
      upgraded.close();
    }
  } finally {
    temp.cleanup();
  }
});

test("category writes join rollback and retain explicit originating runs after resume", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const swarm = seedSwarm(db);
    const eventCount = db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ?").get(swarm.id)?.n;
    const sample = { ...legacy, costBreakdown: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
    assert.throws(
      () =>
        db.write(() => {
          recordUsage(db, swarm.id, "Maria", sample, T0);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(agentUsageTotals(db, swarm.id, "Maria").costBreakdown, undefined);
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ?").get(swarm.id)?.n, eventCount);
    endRun(db, swarm.id, process.pid, "stopped", T0 + 1, 1);
    beginResume(db, swarm.id, process.pid, T0 + 2);
    recordUsage(db, swarm.id, "Maria", sample, T0 + 3, 1);
    assert.equal(db.sql.prepare("SELECT run FROM usage WHERE swarm_id = ?").get(swarm.id)?.run, 1);
    assert.equal(agentUsageTotals(db, swarm.id, "Maria").costBreakdown?.input.usd, 1);
  } finally {
    temp.cleanup();
  }
});

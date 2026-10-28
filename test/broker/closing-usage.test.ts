import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentHooks } from "../../src/broker/agent-hooks.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { systemNotice } from "../helpers/system-notice.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { getStats } from "../../src/store/stats-queries.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const sample = {
  kind: "message" as const,
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0.5,
  costKnown: true,
  model: "alpha",
};

test("closing hooks charge the originating run after resume without advancing current status or delivery", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    const message = systemNotice(temp.db, { swarmId: swarm.id, to: "Maria", text: "Must remain pending", now: T0 });
    endRun(temp.db, swarm.id, process.pid, "stopped", T0 + 10);
    assert.equal(beginResume(temp.db, swarm.id, process.pid, T0 + 20).run, 2);
    const hooks = createAgentHooks({
      db: temp.db,
      swarmId: swarm.id,
      run: 1,
      runnerPid: process.pid,
      name: "Maria",
      clock: new FakeClock(T0 + 30),
      isEnding: () => false,
      onCrash: () => assert.fail("Closing hooks must not revive or report another crash"),
    });
    hooks.onUsage(sample);
    hooks.onStatus("idle");
    hooks.onStatus("working");
    hooks.onActivity({ kind: "writing" });
    hooks.onMessagesRead([message.id]);
    assert.equal(getStats(temp.db, swarm.id, T0 + 30)?.totals.cost, 0.5);
    assert.deepEqual(
      temp.db.sql
        .prepare("SELECT run, cost FROM usage WHERE swarm_id = ?")
        .all(swarm.id)
        .map((row) => [row.run, row.cost]),
      [[1, 0.5]],
    );
    const worker = temp.db.sql
      .prepare("SELECT status, activity, first_idle_at FROM participants WHERE swarm_id = ? AND name = 'Maria'")
      .get(swarm.id);
    assert.equal(worker?.status, "pending");
    assert.equal(worker?.activity, null);
    assert.equal(worker?.first_idle_at, null);
    assert.equal(
      temp.db.sql
        .prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'Maria'")
        .get(message.id)?.status,
      "pending",
    );
    recordUsage(temp.db, swarm.id, "Maria", sample, T0 + 31);
    assert.deepEqual(
      temp.db.sql
        .prepare("SELECT run FROM usage WHERE swarm_id = ? ORDER BY id")
        .all(swarm.id)
        .map((row) => row.run),
      [1, 2],
    );
    assert.equal(getStats(temp.db, swarm.id, T0 + 31)?.totals.cost, 1);
  } finally {
    temp.cleanup();
  }
});

test("callbacks from a replaced run owner cannot mark first idle or activity even before its local stop flag", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    let crashes = 0;
    const hooks = createAgentHooks({
      db: temp.db,
      swarmId: swarm.id,
      run: 1,
      runnerPid: process.pid,
      name: "Maria",
      clock: new FakeClock(T0),
      isEnding: () => false,
      onCrash: () => {
        crashes++;
      },
    });
    temp.db.sql.prepare("UPDATE swarms SET runner_pid = ? WHERE id = ?").run(process.pid + 1, swarm.id);
    hooks.onStatus("idle");
    hooks.onActivity({ kind: "writing" });
    hooks.onCrash({ reason: "exit", fatal: false, message: "old owner", exitCode: 1, signal: null, stderrTail: "" });
    const worker = temp.db.sql
      .prepare("SELECT status, activity, first_idle_at FROM participants WHERE swarm_id = ? AND name = 'Maria'")
      .get(swarm.id);
    assert.equal(worker?.status, "pending");
    assert.equal(worker?.activity, null);
    assert.equal(worker?.first_idle_at, null);
    assert.equal(crashes, 0);
    hooks.onUsage(sample);
    assert.equal(getStats(temp.db, swarm.id, T0)?.totals.cost, 0.5);
  } finally {
    temp.cleanup();
  }
});

test("a failed attribution-gap write rolls usage and its outbox event back together", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    temp.db.sql.exec(`CREATE TRIGGER fail_accounting_gap BEFORE INSERT ON budget_accounting_gaps
      BEGIN SELECT RAISE(FAIL, 'injected gap failure'); END;`);
    const hooks = createAgentHooks({
      db: temp.db,
      swarmId: swarm.id,
      run: 1,
      name: "Maria",
      clock: new FakeClock(T0),
      isEnding: () => true,
      onCrash: () => {},
    });
    assert.throws(() => hooks.onUsage({ ...sample, cost: 0, costKnown: false }), /injected gap failure/);
    assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM usage WHERE swarm_id = ?").get(swarm.id)?.n, 0);
    assert.equal(
      temp.db.sql.prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = ?").get(swarm.id)?.n,
      0,
    );
    assert.equal(
      temp.db.sql
        .prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ? AND type = 'usage.updated'")
        .get(swarm.id)?.n,
      0,
    );
  } finally {
    temp.cleanup();
  }
});

test("money refusal is thrown only after its usage and attribution gap commit", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db, { agents: ["Maria"] });
    // Keep fault injection in the DB rather than starting a model or rewriting runtime settings.
    saveRunConfiguration(
      temp.db,
      swarm.id,
      1,
      {
        version: 1,
        workers: [{ name: "Maria", provider: "fixture", modelId: "alpha", thinkingLevel: "off" }],
        launch: { projectTrusted: false, noExtensions: true, extensionArgs: [] },
        timing: {
          staggerSeconds: 0,
          idleReminderDelay: 1,
          heartbeatMs: 1,
          deliveryPollMs: 1,
          completionCheckMs: 1,
          progressMs: 1,
          resumeStaggerMs: 1,
          reviveBackoffMs: [1],
        },
        limits: { maxRpcFrameBytes: 16 * 1024 * 1024 },
        budget: { moneyUsd: 1, timeSeconds: null, gracefulShutdown: false },
      },
      T0,
    );
    const hooks = createAgentHooks({
      db: temp.db,
      swarmId: swarm.id,
      run: 1,
      name: "Maria",
      clock: new FakeClock(T0),
      isEnding: () => true,
      onCrash: () => {},
    });
    assert.throws(() => hooks.onUsage({ ...sample, cost: 0, costKnown: false }), /accounting is incomplete/);
    assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM usage WHERE swarm_id = ?").get(swarm.id)?.n, 1);
    assert.equal(
      temp.db.sql.prepare("SELECT COUNT(*) AS n FROM budget_accounting_gaps WHERE swarm_id = ?").get(swarm.id)?.n,
      1,
    );
  } finally {
    temp.cleanup();
  }
});

test("usage cannot be attributed to an absent or invalid originating run", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    for (const run of [0, -1, 999, Number.NaN, 1.5]) {
      assert.throws(() => recordUsage(temp.db, swarm.id, "Maria", sample, T0, run), /existing originating run/);
    }
    assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM usage WHERE swarm_id = ?").get(swarm.id)?.n, 0);
  } finally {
    temp.cleanup();
  }
});

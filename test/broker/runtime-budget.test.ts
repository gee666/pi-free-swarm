import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { raiseSwarmBudget } from "../../src/broker/budget-policy.js";
import type { RunConfiguration } from "../../src/run-configuration.js";
import { RunBudget } from "../../src/broker/run-budget.js";
import { systemClock } from "../../src/clock.js";
import { loadSettings } from "../../src/settings.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { checkUsageAccounting, hasBudgetAccountingGap, getBudgetRaises, readBudget } from "../../src/store/budget.js";
import { getRunConfiguration, saveRunConfiguration } from "../../src/store/run-configuration.js";
import { appendConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { queueConfigurationChange, claimConfigurationRequest } from "../../src/store/runtime-configuration.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function fixture(budget: RunConfiguration["budget"] = { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: false }) {
  const swarm = seedSwarm(db);
  saveRunConfiguration(
    db,
    swarm.id,
    1,
    {
      version: 1,
      workers: ["Maria", "John", "Liam"].map((name) => ({
        name,
        provider: "fixture",
        modelId: "worker",
        thinkingLevel: null,
      })),
      launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
      timing: {
        staggerSeconds: 0,
        idleReminderDelay: 0,
        idleReminderDigestSize: 1,
        heartbeatMs: 1,
        deliveryPollMs: 1,
        completionCheckMs: 1,
        progressMs: 1,
        resumeStaggerMs: 0,
        reviveBackoffMs: [],
      },
      limits: { bodyMaxChars: 200, maxRpcFrameBytes: 100000 },
      budget,
    },
    T0,
  );
  return swarm.id;
}

function requestCount(swarmId: number) {
  return db.sql.prepare("SELECT COUNT(*) AS n FROM configuration_requests WHERE swarm_id = ?").get(swarmId)?.n;
}

describe("per-swarm durable budget changes", () => {
  it("raises stopped work before resume without changing accounting or initial provenance", () => {
    const id = fixture();
    recordUsage(
      db,
      id,
      "Maria",
      { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1, model: "worker" },
      T0,
    );
    endRun(db, id, process.pid, "stopped", T0 + 1000, 1);
    const initial = db.sql
      .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ?")
      .get(id)?.configuration;
    const saved = raiseSwarmBudget(db, id, { moneyUsd: 20, timeSeconds: 120 }, 0, T0 + 2000);
    assert.equal(saved.revision, 1);
    assert.deepEqual(getBudgetRaises(db, id), { moneyUsd: 20, timeSeconds: 120 });
    assert.equal(
      db.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ?").get(id)?.configuration,
      initial,
    );
    const budget = readBudget(db, id, { budgetMoneyUsd: 10, budgetTimeSeconds: 60 }, T0 + 90000);
    assert.equal(budget.moneyUsd, 20);
    assert.equal(budget.timeSeconds, 120);
    assert.equal(budget.costUsd, 1);
    assert.equal(budget.activeTimeMs, 1000);
    assert.equal(
      db.sql.prepare("SELECT status FROM configuration_requests WHERE swarm_id = ?").get(id)?.status,
      "applied",
    );
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ?").get(id)?.n, 0);
    const reopened = openSwarmDb(db.path, { create: false });
    try {
      assert.deepEqual(getBudgetRaises(reopened, id), { moneyUsd: 20, timeSeconds: 120 });
    } finally {
      reopened.close();
    }
  });

  it("keeps the latest lower ceilings after earlier raises and preserves exhausted usage", () => {
    const id = fixture();
    recordUsage(
      db,
      id,
      "Maria",
      { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 2, model: "worker" },
      T0,
    );
    raiseSwarmBudget(db, id, { moneyUsd: 20, timeSeconds: 120 }, 0, T0);
    const saved = raiseSwarmBudget(db, id, { moneyUsd: 1, timeSeconds: 1 }, 1, T0 + 2000);
    assert.equal(saved.revision, 2);
    assert.deepEqual(getBudgetRaises(db, id), { moneyUsd: 1, timeSeconds: 1 });
    const budget = readBudget(db, id, { budgetMoneyUsd: 10, budgetTimeSeconds: 60 }, T0 + 2000);
    assert.equal(budget.moneyUsd, 1);
    assert.equal(budget.timeSeconds, 1);
    assert.equal(budget.costUsd, 2);
    assert.equal(budget.activeTimeMs, 2000);
    assert.equal(budget.exhausted, "money");
    assert.equal(saved.effective.budget.gracefulShutdown, false);
    const reopened = openSwarmDb(db.path, { create: false });
    try {
      assert.deepEqual(getBudgetRaises(reopened, id), { moneyUsd: 1, timeSeconds: 1 });
    } finally {
      reopened.close();
    }
  });

  it("sets finite ceilings on unlimited work and retains untouched dimensions", () => {
    const id = fixture({ moneyUsd: null, timeSeconds: null, gracefulShutdown: true });
    raiseSwarmBudget(db, id, { moneyUsd: 5 }, 0, T0);
    const first = getRunConfiguration(db, id);
    assert.deepEqual(first?.effective.budget, { moneyUsd: 5, timeSeconds: null, gracefulShutdown: true });
    raiseSwarmBudget(db, id, { timeSeconds: 30 }, 1, T0);
    assert.deepEqual(getBudgetRaises(db, id), { moneyUsd: 5, timeSeconds: 30 });
    const budget = readBudget(db, id, {}, T0);
    assert.equal(budget.moneyUsd, 5);
    assert.equal(budget.timeSeconds, 30);
    assert.equal(budget.gracefulShutdown, true);
  });

  it("enforces newly finite money and time ceilings on originally unlimited runs", () => {
    for (const dimension of ["money", "time"] as const) {
      const id = fixture({ moneyUsd: null, timeSeconds: null, gracefulShutdown: false });
      const env = {
        cwd: temp.cwd,
        db,
        runnerPid: process.pid,
        clock: { ...systemClock, now: () => T0 + 2000 },
        settings: loadSettings(temp.cwd, { globalFile: null }).settings,
        launch: { extensionArgs: [], projectTrusted: false, model: null },
        boardUrl: () => null,
        notifyUser: () => undefined,
      };
      assert.equal(env.settings.budgetMoneyUsd, undefined);
      assert.equal(env.settings.budgetTimeSeconds, undefined);
      let drained = 0;
      let ended = 0;
      const guard = new RunBudget(
        env,
        id,
        1,
        () => drained++,
        () => false,
        () => ended++,
      );
      assert.equal(guard.check(), false);
      if (dimension === "money") {
        recordUsage(
          db,
          id,
          "Maria",
          { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 2, model: "worker" },
          T0,
        );
      }
      raiseSwarmBudget(db, id, dimension === "money" ? { moneyUsd: 1 } : { timeSeconds: 1 }, 0, T0 + 2000);
      assert.equal(guard.check(), true);
      assert.equal(drained, 1);
      assert.equal(ended, 1);
      assert.equal(db.sql.prepare("SELECT reason FROM budget_stops WHERE swarm_id = ?").get(id)?.reason, dimension);
      assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ?").get(id)?.n, 0);
    }
  });

  it("rejects stale revisions and invalid mixed patches without extra requests", () => {
    const id = fixture();
    raiseSwarmBudget(db, id, { moneyUsd: 20 }, 0, T0);
    assert.throws(() => raiseSwarmBudget(db, id, { moneyUsd: 30 }, 0, T0), /revision changed/);
    assert.throws(
      () => raiseSwarmBudget(db, id, { moneyUsd: 30, timeSeconds: 0 }, 1, T0),
      /timeSeconds must be a finite positive/,
    );
    assert.equal(requestCount(id), 1);
    assert.equal(getRunConfiguration(db, id)?.effective.budget.moneyUsd, 20);
  });

  it("fences a stale browser run even when the new run also has revision zero", () => {
    const id = fixture();
    const original = getRunConfiguration(db, id);
    assert.ok(original);
    endRun(db, id, process.pid, "stopped", T0 + 1000, 1);
    beginResume(db, id, process.pid, T0 + 2000);
    saveRunConfiguration(db, id, 2, original.effective, T0 + 2000);
    assert.throws(() => raiseSwarmBudget(db, id, { moneyUsd: 20 }, 0, T0 + 2000, 1), /run changed/);
    assert.equal(requestCount(id), 0);
    raiseSwarmBudget(db, id, { moneyUsd: 20 }, 0, T0 + 2000, 2);
    assert.deepEqual(getBudgetRaises(db, id), { moneyUsd: 20 });
  });

  it("preserves accounting-gap refusal rather than treating higher limits as a repair", () => {
    const id = fixture();
    db.sql
      .prepare(
        "INSERT INTO budget_accounting_gaps (swarm_id,agent,reason,created_at) VALUES (?, 'Maria', 'missing USD usage total', ?)",
      )
      .run(id, T0);
    assert.throws(() => raiseSwarmBudget(db, id, { moneyUsd: 30 }, 0, T0), /cannot repair unknown costs/);
    assert.equal(requestCount(id), 0);
    assert.deepEqual(getBudgetRaises(db, id), {});
  });

  it("retains committed ceilings after an interrupted applying request, without replaying pending intent", () => {
    const id = fixture();
    const request = queueConfigurationChange(db, id, "User", { type: "raiseBudget", moneyUsd: 20 }, 0, T0);
    assert.deepEqual(getBudgetRaises(db, id), {}, "queueing alone is not an applied increase");
    claimConfigurationRequest(db, request.id, process.pid, T0);
    const before = getRunConfiguration(db, id);
    assert.ok(before);
    appendConfigurationRevision(
      db,
      id,
      1,
      { ...before.effective, budget: { ...before.effective.budget, moneyUsd: 20 } },
      0,
      T0,
    );
    assert.deepEqual(getBudgetRaises(db, id), { moneyUsd: 20 });
    assert.equal(readBudget(db, id, { budgetMoneyUsd: 10, budgetTimeSeconds: 60 }, T0).moneyUsd, 20);
    assert.equal(
      db.sql.prepare("SELECT status FROM configuration_requests WHERE id = ?").get(request.id)?.status,
      "applying",
    );
  });

  it("still checks in-flight archived usage against its recorded old model", () => {
    const id = fixture();
    const before = getRunConfiguration(db, id);
    assert.ok(before);
    db.sql
      .prepare(
        "UPDATE participants SET retired_at = ?, retired_model_id = 'worker', status = 'stopped' WHERE swarm_id = ? AND name = 'Maria'",
      )
      .run(T0, id);
    appendConfigurationRevision(
      db,
      id,
      1,
      { ...before.effective, workers: before.effective.workers.filter((worker) => worker.name !== "Maria") },
      0,
      T0,
    );
    const issue = checkUsageAccounting(
      db,
      id,
      "Maria",
      { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 2, model: "unexpected" },
      T0,
    );
    assert.ok(issue instanceof Error);
    assert.match(issue.message, /unexpected model/);
    assert.equal(hasBudgetAccountingGap(db, id), true);
  });

  it("retains archived workers' spend, run time and accounting gaps", () => {
    const id = fixture();
    recordUsage(
      db,
      id,
      "Maria",
      { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 2, model: "worker" },
      T0,
    );
    db.sql
      .prepare("UPDATE participants SET retired_at = ?, status = 'stopped' WHERE swarm_id = ? AND name = 'Maria'")
      .run(T0 + 1000, id);
    db.sql
      .prepare(
        "INSERT INTO budget_accounting_gaps (swarm_id,agent,reason,created_at) VALUES (?, 'Maria', 'missing USD usage total', ?)",
      )
      .run(id, T0);
    const budget = readBudget(db, id, { budgetMoneyUsd: 10, budgetTimeSeconds: 60 }, T0 + 5000);
    assert.equal(budget.costUsd, 2);
    assert.equal(budget.activeTimeMs, 5000);
    assert.match(budget.accounting, /Accounting is incomplete/);
    assert.throws(() => raiseSwarmBudget(db, id, { moneyUsd: 30 }, 0, T0 + 5000), /cannot repair unknown costs/);
  });

  it("joins outer rollback across request, revision, outbox and raised policy", () => {
    const id = fixture();
    const events = db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ?").get(id)?.n;
    assert.throws(
      () =>
        db.write(() => {
          raiseSwarmBudget(db, id, { moneyUsd: 20 }, 0, T0);
          throw new Error("outer rollback");
        }),
      /outer rollback/,
    );
    assert.equal(requestCount(id), 0);
    assert.deepEqual(getBudgetRaises(db, id), {});
    assert.equal(getRunConfiguration(db, id)?.revision, undefined);
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ?").get(id)?.n, events);
  });
});

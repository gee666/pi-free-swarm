import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { RunBudget } from "../../src/broker/run-budget.js";
import type { RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

function environment(): RunEnvironment {
  return {
    cwd: temp.cwd,
    db: temp.db,
    runnerPid: process.pid,
    clock: { ...systemClock, now: () => T0 },
    settings: loadSettings(temp.cwd, { globalFile: null }).settings,
    launch: { extensionArgs: [], projectTrusted: false, model: null },
    boardUrl: () => null,
    notifyUser: () => undefined,
  };
}

test("unlimited active runs skip budget polling entirely", () => {
  const tracked = mock.method(temp.db.sql, "prepare", () => {
    throw new Error("Unexpected budget query");
  });
  try {
    const budget = new RunBudget(
      environment(),
      999,
      1,
      () => assert.fail("unexpected drain"),
      () => false,
      () => assert.fail("unexpected end"),
    );
    assert.equal(budget.check(), false);
  } finally {
    tracked.mock.restore();
  }
});

test("a new accounting gap refuses continuing money enforcement without fabricating budget exhaustion or votes", () => {
  const { id } = seedSwarm(temp.db);
  const env = environment();
  env.settings.budgetMoneyUsd = 10;
  temp.db.sql
    .prepare(
      "INSERT INTO budget_accounting_gaps (swarm_id, agent, reason, created_at) VALUES (?, 'Maria', 'missing USD usage total', ?)",
    )
    .run(id, T0);
  const budget = new RunBudget(
    env,
    id,
    1,
    () => assert.fail("not an exhaustion drain"),
    () => false,
    () => assert.fail("not an exhaustion verdict"),
  );
  assert.throws(() => budget.check(), /Money budget accounting is incomplete/);
  assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM budget_stops WHERE swarm_id = ?").get(id)?.n, 0);
  assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ?").get(id)?.n, 0);
});

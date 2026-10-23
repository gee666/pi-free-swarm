import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { configureRun } from "../../src/broker/run-configuration.js";
import { DEFAULT_TIMINGS, type RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { loadSettings } from "../../src/settings.js";
import { appendConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { readBudget } from "../../src/store/budget.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

test("budget polling reads aggregate usage and run time without materializing archived worker statistics", () => {
  const agents = ["Current", ...Array.from({ length: 50 }, (_, index) => `Archive${index}`)];
  const { id } = seedSwarm(temp.db, { agents });
  temp.db.sql
    .prepare("UPDATE participants SET retired_at = ?, status = 'stopped' WHERE swarm_id = ? AND name LIKE 'Archive%'")
    .run(T0, id);
  temp.db.sql.prepare("UPDATE swarms SET agent_amount = 1 WHERE id = ?").run(id);
  recordUsage(
    temp.db,
    id,
    "Archive0",
    { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 3, model: null },
    T0,
  );
  const queries: string[] = [];
  const original = temp.db.sql.prepare.bind(temp.db.sql);
  const tracked = mock.method(temp.db.sql, "prepare", (query: string) => {
    queries.push(query);
    return original(query);
  });
  try {
    const budget = readBudget(temp.db, id, { budgetMoneyUsd: 10, budgetTimeSeconds: 60 }, T0 + 5000);
    assert.equal(budget.costUsd, 3);
    assert.equal(budget.activeTimeMs, 5000);
    const metadataReads = queries.filter((query) => /FROM\s+(participants|posts|comments|messages)\b/i.test(query));
    assert.equal(metadataReads.length, 0, "budget checks must not load participant and wall statistics");
    assert.equal(
      queries.some((query) => /configuration_requests/.test(query)),
      false,
      "polling must not scan historical requests",
    );
  } finally {
    tracked.mock.restore();
  }
});

test("live budget polling reads only the latest policy, not historical control requests or revisions", () => {
  const history = createTempDb();
  try {
    const { id, env } = configuredBudget(history);
    let configuration = getRunConfiguration(history.db, id);
    assert.ok(configuration);
    for (let revision = 0; revision < 100; revision++) {
      configuration = appendConfigurationRevision(
        history.db,
        id,
        1,
        {
          ...configuration.effective,
          budget: { ...configuration.effective.budget, moneyUsd: 11 + revision },
        },
        revision,
        T0,
      );
    }
    let numericReads = 0;
    history.db.sql.function("json_extract", (document: unknown, pointer: unknown) => {
      numericReads++;
      if (typeof document !== "string" || typeof pointer !== "string" || !pointer.startsWith("$.")) return null;
      let value: unknown = JSON.parse(document);
      for (const part of pointer.slice(2).split(".")) {
        if (typeof value !== "object" || value === null) return null;
        value = Reflect.get(value, part);
      }
      if (typeof value === "boolean") return Number(value);
      return typeof value === "number" || typeof value === "string" ? value : null;
    });
    const queries: string[] = [];
    const original = history.db.sql.prepare.bind(history.db.sql);
    const tracked = mock.method(history.db.sql, "prepare", (query: string) => {
      queries.push(query);
      return original(query);
    });
    try {
      assert.equal(readBudget(history.db, id, env.settings, T0 + 5000).moneyUsd, 110);
      assert.equal(numericReads, 2, "only the two numeric ceilings from the latest policy are extracted");
      assert.equal(
        queries.some((query) => /configuration_requests/.test(query)),
        false,
      );
      appendConfigurationRevision(
        history.db,
        id,
        1,
        { ...configuration.effective, budget: { ...configuration.effective.budget, moneyUsd: 111 } },
        100,
        T0,
      );
      numericReads = 0;
      assert.equal(
        readBudget(history.db, id, env.settings, T0 + 5000).moneyUsd,
        111,
        "no stale in-memory policy cache",
      );
      assert.equal(numericReads, 2);
    } finally {
      tracked.mock.restore();
    }
  } finally {
    history.cleanup();
  }
});

test("stored missing or mistyped policy fields never become unlimited or boolean guesses", () => {
  const policy = createTempDb();
  try {
    const { id, env } = configuredBudget(policy);
    const saved = getRunConfiguration(policy.db, id);
    assert.ok(saved);
    const invalid = [
      { timeSeconds: 60, gracefulShutdown: false },
      { moneyUsd: 10, gracefulShutdown: false },
      { moneyUsd: true, timeSeconds: 60, gracefulShutdown: false },
      { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: 0 },
      { moneyUsd: 10, timeSeconds: 60, gracefulShutdown: "false" },
    ];
    for (const budget of invalid) {
      policy.db.sql
        .prepare("UPDATE run_configurations SET configuration = ? WHERE swarm_id = ?")
        .run(JSON.stringify({ ...saved.effective, budget }), id);
      assert.throws(() => readBudget(policy.db, id, env.settings, T0), /Stored effective budget policy is invalid/);
    }
    policy.db.sql
      .prepare("UPDATE run_configurations SET configuration = ? WHERE swarm_id = ?")
      .run(
        JSON.stringify({ ...saved.effective, budget: { moneyUsd: null, timeSeconds: 60, gracefulShutdown: false } }),
        id,
      );
    assert.equal(readBudget(policy.db, id, env.settings, T0).moneyUsd, null, "explicit JSON null remains unlimited");
  } finally {
    policy.cleanup();
  }
});

test("interrupted timing discloses uncertainty without charging the later read or discovery time", () => {
  const { id } = seedSwarm(temp.db);
  temp.db.sql
    .prepare("UPDATE swarm_runs SET ended_at = ?, end_status = 'interrupted' WHERE swarm_id = ?")
    .run(T0 + 1000, id);
  const budget = readBudget(temp.db, id, { budgetTimeSeconds: 60 }, T0 + 86400000);
  assert.equal(budget.activeTimeMs, 1000);
  assert.equal(budget.hasInterruptedRuns, true);
  assert.equal(budget.exhausted, null);
  assert.match(budget.accounting, /unobserved final interval/);
  assert.match(budget.accounting, /same-run worker usage\/spans/);
  assert.match(budget.accounting, /not the later discovery time/);
});

function configuredBudget(project: TempDb): { id: number; env: RunEnvironment } {
  const { id } = seedSwarm(project.db, { agents: ["Current"] });
  const env: RunEnvironment = {
    cwd: project.cwd,
    db: project.db,
    runnerPid: process.pid,
    clock: { ...systemClock, now: () => T0 },
    settings: {
      ...loadSettings(project.cwd, { globalFile: null }).settings,
      budgetMoneyUsd: 10,
      budgetTimeSeconds: 60,
    },
    launch: {
      extensionArgs: [],
      projectTrusted: false,
      model: { provider: "fixture", modelId: "worker", thinkingLevel: "off" },
    },
    availableModels: [{ provider: "fixture", id: "worker", thinkingLevels: ["off"], pricingKnown: true }],
    boardUrl: () => null,
    notifyUser: () => undefined,
  };
  configureRun(env, id, 1, ["Current"], DEFAULT_TIMINGS);
  return { id, env };
}

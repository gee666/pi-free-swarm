import assert from "node:assert/strict";
import { it } from "node:test";
import { configureRun } from "../../src/broker/run-configuration.js";
import { buildRunSpec } from "../../src/broker/run-spec.js";
import { DEFAULT_TIMINGS, type RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { loadSettings } from "../../src/settings.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { applyRosterConfiguration } from "../../src/store/active-roster.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

function fixture() {
  const temp = createTempDb();
  const swarm = seedSwarm(temp.db, { agents: ["Maria", "John", "Liam"], now: Date.now() });
  const notes: string[] = [];
  const env: RunEnvironment = {
    cwd: temp.cwd,
    db: temp.db,
    runnerPid: process.pid,
    clock: systemClock,
    settings: loadSettings(temp.cwd).settings,
    launch: {
      extensionArgs: ["index.ts"],
      projectTrusted: true,
      model: { provider: "a", modelId: "one", thinkingLevel: "off" },
    },
    availableModels: [
      { provider: "a", id: "one", thinkingLevels: ["off"] },
      { provider: "b", id: "two", thinkingLevels: ["high"] },
    ],
    boardUrl: () => null,
    notifyUser: (text) => notes.push(text),
  };
  return { ...temp, swarm, env, notes };
}

it("persists exact named allocations and launches their actual model, leaving Watcher inherited", () => {
  const f = fixture();
  try {
    f.env.settings.models = [
      { provider: "a", model: "one", thinkingLevel: "off", count_proportional: 2 },
      { provider: "b", model: "two", thinkingLevel: "high" },
    ];
    const slots = configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam", WATCHER_NAME], DEFAULT_TIMINGS);
    assert.equal(slots.size, 3);
    assert.equal(slots.get("Liam")?.modelId, "two");
    assert.equal(slots.has(WATCHER_NAME), false);
    const spec = buildRunSpec(f.env, f.swarm.id, "Liam", "session.jsonl", 1, slots.get("Liam"));
    assert.deepEqual(spec.context.model, slots.get("Liam"));
    const saved = getRunConfiguration(f.db, f.swarm.id, 1);
    assert.deepEqual(
      saved?.effective.workers.map(({ name }) => name),
      ["Maria", "John", "Liam"],
    );
    assert.equal(saved?.effective.launch.projectTrusted, true);
    assert.equal(saved?.effective.limits.maxAgents, f.env.settings.maxAgents);
    assert.equal(saved?.effective.workers[2]?.thinkingLevel, "high");
  } finally {
    f.cleanup();
  }
});

it("retains assignments by identity across resume and reports changed requested profiles and limits", () => {
  const f = fixture();
  try {
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    f.env.settings.models = [{ provider: "b", model: "two", thinkingLevel: "high" }];
    const resumed = configureRun(f.env, f.swarm.id, 2, ["Liam", "Maria", "John"], DEFAULT_TIMINGS);
    assert.equal(resumed.get("Liam")?.modelId, "one");
    assert.ok(f.notes.some((note) => note.includes("Keeping each worker's recorded")));
    assert.ok(!getRunConfiguration(f.db, f.swarm.id, 2)?.changes.includes("limits"));
    assert.throws(() => configureRun(f.env, f.swarm.id, 3, ["Maria"], DEFAULT_TIMINGS), /team size/);
  } finally {
    f.cleanup();
  }
});

it("records effective watchdog overrides and surfaces recovery policy changes on resume", () => {
  const f = fixture();
  try {
    const timing = { ...DEFAULT_TIMINGS, watchdog: { startupTimeoutMs: 321, idleTimeoutMs: 654, startupRetries: 1 } };
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], timing);
    const saved = getRunConfiguration(f.db, f.swarm.id, 1)?.effective.timing;
    assert.equal(saved?.startupTimeoutMs, 321);
    assert.equal(saved?.idleTimeoutMs, 654);
    assert.equal(saved?.startupRetries, 1);
    timing.watchdog.startupRetries = 2;
    configureRun(f.env, f.swarm.id, 2, ["Maria", "John", "Liam"], timing);
    assert.ok(getRunConfiguration(f.db, f.swarm.id, 2)?.changes.includes("timing"));
  } finally {
    f.cleanup();
  }
});

it("resumes the revised named assignments without rewriting the original run snapshot", () => {
  const f = fixture();
  try {
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    const initial = getRunConfiguration(f.db, f.swarm.id, 1);
    assert.ok(initial);
    const effective = structuredClone(initial.effective);
    effective.workers = effective.workers.filter((worker) => worker.name !== "Liam");
    effective.workers.push(
      { name: "Alice", provider: "b", modelId: "two", thinkingLevel: "high" },
      { name: "James", provider: "a", modelId: "one", thinkingLevel: "off" },
    );
    applyRosterConfiguration(f.db, f.swarm.id, 1, effective, 0, Date.now());
    assert.ok(listAgentSessions(f.db, f.swarm.id).some((worker) => worker.name === "Liam"));
    const active = listAgentSessions(f.db, f.swarm.id, { activeOnly: true }).map((worker) => worker.name);
    assert.equal(active.includes("Liam"), false);
    assert.ok(active.includes("Alice"));
    assert.equal(endRun(f.db, f.swarm.id, process.pid, "stopped", Date.now(), 1), true);
    const next = beginResume(f.db, f.swarm.id, process.pid, Date.now());
    const resumed = configureRun(f.env, f.swarm.id, next.run, active, DEFAULT_TIMINGS);
    assert.equal(resumed.size, 4);
    assert.equal(resumed.get("Alice")?.modelId, "two");
    assert.equal(resumed.get("James")?.modelId, "one");
    assert.equal(resumed.has("Liam"), false);
    const original = f.db.sql
      .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1")
      .get(f.swarm.id);
    assert.ok(original);
    assert.ok(String(original.configuration).includes("Liam"));
    assert.equal(String(original.configuration).includes("Alice"), false);
  } finally {
    f.cleanup();
  }
});

it("keeps historical unknown maximums honest while capturing the new run's effective limit", () => {
  const f = fixture();
  try {
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    f.db.sql
      .prepare(
        "UPDATE run_configurations SET configuration = json_remove(configuration, '$.limits.maxAgents') WHERE swarm_id = ?",
      )
      .run(f.swarm.id);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 1)?.effective.limits.maxAgents, undefined);
    f.env.settings.maxAgents++;
    configureRun(f.env, f.swarm.id, 2, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 2)?.effective.limits.maxAgents, f.env.settings.maxAgents);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 1)?.effective.limits.maxAgents, undefined);
  } finally {
    f.cleanup();
  }
});

it("retains explicit per-swarm budget ceilings across changed file defaults on resume", () => {
  const f = fixture();
  try {
    f.env.settings.budgetMoneyUsd = 10;
    f.env.settings.budgetTimeSeconds = 100;
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    f.db.sql
      .prepare(
        "INSERT INTO configuration_requests (swarm_id, run, expected_revision, change, requested_by, status, created_at) VALUES (?, 1, 0, ?, 'User', 'applied', ?)",
      )
      .run(f.swarm.id, JSON.stringify({ type: "raiseBudget", moneyUsd: 20, timeSeconds: 200 }), Date.now());
    f.env.settings.budgetMoneyUsd = 15;
    f.env.settings.budgetTimeSeconds = 150;
    configureRun(f.env, f.swarm.id, 2, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 2)?.effective.budget.moneyUsd, 20);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 2)?.effective.budget.timeSeconds, 200);
    assert.ok(f.notes.some((note) => note.includes("Retaining this swarm's approved runtime budget ceilings")));
    f.notes.length = 0;
    f.env.settings.budgetMoneyUsd = 25;
    f.env.settings.budgetTimeSeconds = 250;
    configureRun(f.env, f.swarm.id, 3, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 3)?.effective.budget.moneyUsd, 20);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 3)?.effective.budget.timeSeconds, 200);
    assert.ok(f.notes.some((note) => note.includes("Retaining this swarm's approved runtime budget ceilings")));
  } finally {
    f.cleanup();
  }
});

it("fails clearly for missing inherited model or unavailable saved model without saving a new run", () => {
  const f = fixture();
  try {
    const inherited = f.env.launch.model;
    f.env.launch.model = null;
    assert.throws(
      () => configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS),
      /Select a Main model/,
    );
    assert.equal(getRunConfiguration(f.db, f.swarm.id), null);
    f.env.launch.model = inherited;
    configureRun(f.env, f.swarm.id, 1, ["Maria", "John", "Liam"], DEFAULT_TIMINGS);
    f.env.availableModels = [];
    assert.throws(() => configureRun(f.env, f.swarm.id, 2, ["Maria", "John", "Liam"], DEFAULT_TIMINGS), /unavailable/);
    assert.equal(getRunConfiguration(f.db, f.swarm.id, 2), null);
  } finally {
    f.cleanup();
  }
});

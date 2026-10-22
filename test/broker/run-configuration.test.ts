import assert from "node:assert/strict";
import { it } from "node:test";
import { configureRun } from "../../src/broker/run-configuration.js";
import { buildRunSpec } from "../../src/broker/run-spec.js";
import { DEFAULT_TIMINGS, type RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { loadSettings } from "../../src/settings.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

function fixture() {
  const temp = createTempDb();
  const swarm = seedSwarm(temp.db, { agents: ["Maria", "John", "Liam"] });
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
    f.env.settings.bodyMaxChars++;
    const resumed = configureRun(f.env, f.swarm.id, 2, ["Liam", "Maria", "John"], DEFAULT_TIMINGS);
    assert.equal(resumed.get("Liam")?.modelId, "one");
    assert.ok(f.notes.some((note) => note.includes("Keeping each worker's recorded")));
    assert.ok(getRunConfiguration(f.db, f.swarm.id, 2)?.changes.includes("limits"));
    assert.equal(
      getRunConfiguration(f.db, f.swarm.id, 1)?.effective.limits.bodyMaxChars,
      f.env.settings.bodyMaxChars - 1,
    );
    assert.throws(() => configureRun(f.env, f.swarm.id, 3, ["Maria"], DEFAULT_TIMINGS), /team size/);
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

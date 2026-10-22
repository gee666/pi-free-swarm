import assert from "node:assert/strict";
import path from "node:path";
import { after, it } from "node:test";
import { buildRunSpec } from "../../src/broker/run-spec.js";
import { buildAgentArgs } from "../../src/agents/launch.js";
import { resolveModelAssignments } from "../../src/model-allocation.js";
import type { RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { RUN_ENV } from "../../src/constants.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

it("passes each allocated effective model and thinking into launch arguments without changing Main context", () => {
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  const inherited = { provider: "parent", modelId: "main", thinkingLevel: "medium" };
  const profiles = [
    { provider: "first", model: "one", thinkingLevel: "high", count_proportional: 2 },
    { provider: "second", model: "two", thinkingLevel: "off" },
  ];
  const available = profiles.map((profile) => ({
    provider: profile.provider,
    id: profile.model,
    thinkingLevels: [profile.thinkingLevel],
  }));
  const models = resolveModelAssignments(3, profiles, inherited, available);
  const env: RunEnvironment = {
    cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings: loadSettings(cwd).settings,
    launch: { extensionArgs: [], projectTrusted: false, model: inherited },
    boardUrl: () => null,
    notifyUser: () => {},
  };
  assert.deepEqual(
    models.map((model) => model.provider),
    ["first", "first", "second"],
  );
  models.forEach((model, slot) => {
    const spec = buildRunSpec(env, swarm.id, `worker-${slot}`, path.join(cwd, `${slot}.jsonl`), 1, model);
    const args = buildAgentArgs(spec);
    assert.equal(args[args.indexOf("--model") + 1], `${model.provider}/${model.modelId}`);
    assert.equal(args[args.indexOf("--thinking") + 1], model.thinkingLevel);
  });
  assert.deepEqual(env.launch.model, inherited);
});

it("passes the captured run into each worker launch, even if the database has advanced", () => {
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  const env: RunEnvironment = {
    cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings: loadSettings(cwd).settings,
    launch: { extensionArgs: [], projectTrusted: false, model: null },
    boardUrl: () => null,
    notifyUser: () => {},
  };
  const session = path.join(db.dataDir, "sessions", String(swarm.id), "Maria", "session.jsonl");
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(swarm.id);
  assert.equal(buildRunSpec(env, swarm.id, "Maria", session, 1).env[RUN_ENV], "1");
  assert.equal(buildRunSpec(env, swarm.id, "Maria", session, 2).env[RUN_ENV], "2");
});

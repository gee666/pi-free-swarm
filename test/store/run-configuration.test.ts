import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { RunConfiguration } from "../../src/run-configuration.js";
import { getRunConfiguration, saveRunConfiguration } from "../../src/store/run-configuration.js";
import { getParticipant, getSwarm } from "../../src/store/swarm-queries.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
function config(): RunConfiguration {
  return {
    version: 1,
    workers: [{ name: "Maria", provider: "fixture", modelId: "alpha", thinkingLevel: "high" }],
    launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
    timing: {
      staggerSeconds: 1,
      idleReminderDelay: 100,
      heartbeatMs: 1,
      deliveryPollMs: 2,
      completionCheckMs: 3,
      progressMs: 4,
      resumeStaggerMs: 5,
      reviveBackoffMs: [1, 2],
    },
    limits: { maxRpcFrameBytes: 1000000 },
    budget: { moneyUsd: null, timeSeconds: 10, gracefulShutdown: false },
  };
}

describe("saved effective run configuration", () => {
  it("reports historical metadata as unknown and isolates swarm/run records", () => {
    const first = seedSwarm(temp.db);
    const second = seedSwarm(temp.db);
    assert.equal(getRunConfiguration(temp.db, first.id), null);
    assert.equal(getSwarm(temp.db, first.id, T0)?.configuration, null);
    assert.equal(getParticipant(temp.db, first.id, "Maria")?.kind, "agent");
    const agent = getParticipant(temp.db, first.id, "Maria");
    assert.equal(agent?.kind === "agent" && agent.model, null);
    const saved = saveRunConfiguration(temp.db, first.id, 1, config(), T0);
    assert.deepEqual(getRunConfiguration(temp.db, first.id), saved);
    assert.equal(getRunConfiguration(temp.db, second.id), null);
    assert.equal(getRunConfiguration(temp.db, first.id, 2), null);
    assert.deepEqual(getSwarm(temp.db, first.id, T0)?.configuration, saved);
    const assigned = getParticipant(temp.db, first.id, "Maria");
    assert.deepEqual(assigned?.kind === "agent" && assigned.model, saved.effective.workers[0]);
  });

  it("does not apply a previous run assignment to an unrecorded current run", () => {
    const swarm = seedSwarm(temp.db);
    saveRunConfiguration(temp.db, swarm.id, 1, config(), T0);
    temp.db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(swarm.id);
    assert.equal(getSwarm(temp.db, swarm.id, T0)?.configuration, null);
    const agent = getParticipant(temp.db, swarm.id, "Maria");
    assert.equal(agent?.kind === "agent" && agent.model, null);
  });

  it("persists through reopen, compares resumes, and strips attached credential objects", () => {
    const swarm = seedSwarm(temp.db);
    const input = { ...config(), env: { TOKEN: "must-not-persist" } };
    saveRunConfiguration(temp.db, swarm.id, 1, input, T0);
    const next = config();
    next.budget.timeSeconds = 30;
    next.timing.staggerSeconds = 2;
    const saved = saveRunConfiguration(temp.db, swarm.id, 2, next, T0 + 1);
    assert.deepEqual(saved.changes, ["timing", "budget"]);
    const reopened = openSwarmDb(temp.db.path, { create: false });
    try {
      assert.deepEqual(getRunConfiguration(reopened, swarm.id, 2), saved);
      assert.equal(getRunConfiguration(reopened, swarm.id, 1)?.effective.budget.timeSeconds, 10);
      const raw = reopened.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ?").all(swarm.id);
      assert.equal(JSON.stringify(raw).includes("must-not-persist"), false);
      assert.equal(JSON.stringify(raw).includes("TOKEN"), false);
    } finally {
      reopened.close();
    }
  });

  it("redacts extension URL credentials and keeps credential rotation out of resume differences", () => {
    const swarm = seedSwarm(temp.db);
    const input = config();
    input.launch.extensionArgs = [
      "-e",
      "git:https://alice:first-secret@example.test/team/pkg?token=private#private-fragment",
      "/safe/local/index.ts",
    ];
    const saved = saveRunConfiguration(temp.db, swarm.id, 1, input, T0);
    assert.deepEqual(saved.effective.launch.extensionArgs, [
      "-e",
      "git:https://example.test/team/pkg",
      "/safe/local/index.ts",
    ]);
    input.launch.extensionArgs[1] = "git:https://alice:rotated-secret@example.test/team/pkg?token=rotated";
    const resumed = saveRunConfiguration(temp.db, swarm.id, 2, input, T0 + 1);
    assert.deepEqual(resumed.changes, []);
    const raw = temp.db.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ?").all(swarm.id);
    const api = JSON.stringify(getSwarm(temp.db, swarm.id, T0)?.configuration);
    assert.equal(JSON.stringify(raw).includes("secret"), false);
    assert.equal(JSON.stringify(raw).includes("private"), false);
    assert.equal(api.includes("first-secret"), false);
    assert.equal(api.includes("alice"), false);
  });

  it("joins outer rollback and does not overwrite provenance for an existing run", () => {
    const swarm = seedSwarm(temp.db);
    assert.throws(
      () =>
        temp.db.write(() => {
          saveRunConfiguration(temp.db, swarm.id, 1, config(), T0);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(getRunConfiguration(temp.db, swarm.id), null);
    saveRunConfiguration(temp.db, swarm.id, 1, config(), T0);
    assert.throws(() => saveRunConfiguration(temp.db, swarm.id, 1, config(), T0 + 1));
    assert.equal(getRunConfiguration(temp.db, swarm.id)?.recordedAt, T0);
  });
});

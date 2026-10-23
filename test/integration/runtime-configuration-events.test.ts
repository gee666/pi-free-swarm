import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAX_RPC_FRAME_BYTES } from "../../src/agents/jsonl.js";
import { markSwarmRunning } from "../../src/broker/swarms.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import type { RunConfiguration } from "../../src/run-configuration.js";
import { appendConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { latestEventId, scanEventsAfter } from "../../src/store/events.js";
import { getRunConfiguration, saveRunConfiguration } from "../../src/store/run-configuration.js";
import {
  claimConfigurationRequest,
  finishConfigurationRequest,
  getRuntimeConfiguration,
  queueConfigurationChange,
} from "../../src/store/runtime-configuration.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { openSse, startTestBoard } from "../server/helpers.js";

// Keep the store/event fixture independent of process-launch and model-catalog helpers.
function initialConfiguration(): RunConfiguration {
  return {
    version: 1,
    workers: ["Maria", "John"].map((name) => ({ name, provider: "fixture", modelId: "alpha", thinkingLevel: "off" })),
    launch: { projectTrusted: false, noExtensions: true, extensionArgs: [] },
    timing: {
      staggerSeconds: 0,
      idleReminderDelay: 1_000,
      idleReminderDigestSize: 1,
      heartbeatMs: 200,
      deliveryPollMs: 50,
      completionCheckMs: 25,
      progressMs: 50,
      resumeStaggerMs: 50,
      reviveBackoffMs: [40],
    },
    limits: { bodyMaxChars: 4_000, maxRpcFrameBytes: DEFAULT_MAX_RPC_FRAME_BYTES },
    budget: { moneyUsd: null, timeSeconds: 60, gracefulShutdown: false },
  };
}

test(
  "configuration request/revision events cross unknown pages atomically without rewriting provenance",
  { timeout: 10_000 },
  async (t) => {
    const clock = new FakeClock(T0);
    const board = await startTestBoard({ clock });
    t.after(() => board.close());
    const { db } = board.temp;
    const swarm = seedSwarm(db, { agents: ["Maria", "John"] });
    const initial = initialConfiguration();
    saveRunConfiguration(db, swarm.id, 1, initial, T0);
    markSwarmRunning(db, swarm.id, process.pid, T0);
    const client = await openSse(`${board.base}/events?swarm=${swarm.id}`);
    t.after(() => client.close());
    clock.advance(1_000);
    const consumptionBefore = getRuntimeConfiguration(db, swarm.id, clock.now())?.budget?.activeTimeMs;
    assert.ok(consumptionBefore !== undefined && consumptionBefore > 0);
    const beforeUnknown = latestEventId(db);
    db.write(({ sql }) => {
      const insert = sql.prepare(
        "INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, 'future.control', '{}', ?)",
      );
      for (let i = 0; i < 500; i++) insert.run(swarm.id, clock.now());
    });
    const request = queueConfigurationChange(
      db,
      swarm.id,
      "User",
      { type: "raiseBudget", timeSeconds: 120 },
      0,
      clock.now(),
    );
    const revised: RunConfiguration = { ...initial, budget: { ...initial.budget, timeSeconds: 120 } };
    const afterQueue = latestEventId(db);
    const apply = () => {
      const claim = claimConfigurationRequest(db, request.id, process.pid, clock.now());
      assert.equal(claim.status, "applying");
      appendConfigurationRevision(db, swarm.id, 1, revised, 0, clock.now());
      finishConfigurationRequest(db, request.id, "applied", null, clock.now());
    };
    assert.throws(
      () =>
        db.write(() => {
          apply();
          throw new Error("rollback fixture");
        }),
      /rollback fixture/,
    );
    assert.equal(getRuntimeConfiguration(db, swarm.id, clock.now())?.revision, 0);
    assert.equal(getRuntimeConfiguration(db, swarm.id, clock.now())?.requests[0].status, "pending");
    assert.equal(latestEventId(db), afterQueue, "rolled-back nested mutations emit no phantom UI refresh");
    db.write(apply);
    const current = getRuntimeConfiguration(db, swarm.id, clock.now());
    assert.equal(current?.revision, 1);
    assert.equal(current?.requests[0].status, "applied");
    assert.equal(current?.budget?.timeSeconds, 120);
    assert.equal(current?.budget?.activeTimeMs, consumptionBefore, "raising a ceiling never resets consumption");
    assert.deepEqual(getRunConfiguration(db, swarm.id)?.effective.workers, initial.workers);
    const original = db.sql
      .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1")
      .get(swarm.id);
    assert.ok(original && typeof original.configuration === "string");
    const savedOriginal: unknown = JSON.parse(original.configuration);
    assert.deepEqual(savedOriginal, initial, "the initial per-run snapshot remains immutable");

    const unknown = scanEventsAfter(db, beforeUnknown, 500);
    assert.deepEqual(unknown.events, []);
    assert.equal(unknown.hasMore, true);
    const known = scanEventsAfter(db, unknown.scannedThrough, 500);
    assert.ok(
      known.events.some((event) => event.type === "swarm.updated" && event.payload.swarm.configuration?.revision === 1),
    );
    clock.advance(EVENTS_TAIL_MS);
    const updated = await client.next(
      ({ event }) => event?.type === "swarm.updated" && event.payload.swarm.configuration?.revision === 1,
    );
    assert.ok(updated.event?.type === "swarm.updated");
    assert.equal(updated.event.payload.swarm.configuration?.effective.budget.timeSeconds, 120);
    assert.deepEqual(updated.event.payload.swarm.configuration?.effective.workers, initial.workers);
    assert.equal(
      new Set(client.frames.flatMap(({ id }) => (id === null ? [] : [id]))).size,
      client.frames.filter(({ id }) => id !== null).length,
    );
  },
);

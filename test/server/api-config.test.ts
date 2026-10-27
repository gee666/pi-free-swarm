import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiErrorBody } from "../../src/api-types.js";
import type { RunConfiguration } from "../../src/run-configuration.js";
import type { RuntimeConfigurationView } from "../../src/runtime-configuration.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import { recordBudgetStop } from "../../src/store/budget.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson as postRequest, startTestBoard, type TestBoard } from "./helpers.js";

// Most fixtures edit the first recorded run; stale-run cases override this explicitly.
function postJson<T = unknown>(url: string, body: Record<string, unknown>) {
  return postRequest<T>(url, { expectedRun: 1, ...body });
}

// Seed provenance without model calls; HTTP requests must not start child processes.
function recordedSwarm(
  board: TestBoard,
  names = ["Maria", "John", "Liam"],
  budget: RunConfiguration["budget"] = { moneyUsd: 1, timeSeconds: 60, gracefulShutdown: false },
) {
  const now = Date.now();
  const swarm = seedSwarm(board.temp.db, { agents: names, now });
  const configuration: RunConfiguration = {
    version: 1,
    workers: names.map((name) => ({ name, provider: "fixture", modelId: "alpha", thinkingLevel: "high" })),
    launch: {
      projectTrusted: false,
      noExtensions: true,
      extensionArgs: ["https://user:secret@example.com/plugin?token=secret"],
    },
    timing: {
      staggerSeconds: 0,
      idleReminderDelay: 100,
      idleReminderDigestSize: 1,
      heartbeatMs: 10,
      deliveryPollMs: 10,
      completionCheckMs: 10,
      progressMs: 10,
      resumeStaggerMs: 10,
      reviveBackoffMs: [10],
    },
    limits: { maxRpcFrameBytes: 16 * 1024 * 1024, maxAgents: 6 },
    budget,
  };
  saveRunConfiguration(board.temp.db, swarm.id, 1, configuration, now);
  return { swarm, url: `${board.base}/api/swarms/${swarm.id}/config` };
}

test("Config HTTP exposes safe current provenance and durable pending User edits without claiming application", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { swarm, url } = recordedSwarm(board);
  const original = (await getJson<RuntimeConfigurationView>(url)).body;
  assert.equal(original.revision, 0);
  assert.equal(original.configuration?.effective.workers.length, 3);
  assert.equal(original.configuration?.effective.limits.maxAgents, 6);
  assert.equal(original.budget?.moneyUsd, 1);
  assert.equal(JSON.stringify(original).includes("secret"), false);
  const queued = await postJson<RuntimeConfigurationView>(url, {
    expectedRevision: 0,
    change: { type: "addAgents", count: 1 },
    requestedBy: "Main",
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.revision, 0);
  assert.equal(queued.body.configuration?.effective.workers.length, 3);
  assert.equal(queued.body.requests[0]?.requestedBy, "User");
  assert.equal(queued.body.requests[0]?.status, "pending");
  assert.deepEqual(queued.body.requests[0]?.change, { type: "addAgents", count: 1 });
  assert.equal(
    board.temp.db.sql.prepare("SELECT agent_amount FROM swarms WHERE id = ?").get(swarm.id)?.agent_amount,
    3,
  );
  const stale = await postJson<ApiErrorBody>(url, { expectedRevision: 1, change: { type: "addAgents", count: 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "validation");
  assert.match(stale.body.message, /refresh/i);
  assert.equal((await getJson<RuntimeConfigurationView>(url)).body.requests.length, 1);
  assert.equal((await getJson(`${board.base}/api/swarms/999999/config`)).status, 404);
});

test("Config HTTP rejects unsupported fields, invalid controls, Watcher removal and last-worker removal", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { url } = recordedSwarm(board, ["Maria"]);
  const submit = (change: unknown) => postJson<ApiErrorBody>(url, { expectedRevision: 0, change });
  assert.equal((await submit({ type: "addAgents", count: 0 })).status, 400);
  assert.equal((await submit({ type: "removeAgent", name: "Watcher" })).status, 409);
  const last = await submit({ type: "removeAgent", name: "Maria" });
  assert.equal(last.status, 409);
  assert.match(last.body.message, /at least one|Stop/);
  assert.equal((await submit({ type: "retireAgent", name: "Maria", handoffFile: "/etc/passwd" })).status, 400);
  assert.equal((await submit({ type: "addAgents", count: 1, model: "unapproved" })).status, 400);
  assert.equal((await submit({ type: "raiseBudget", moneyUsd: 0 })).status, 400);
  assert.equal((await submit({ type: "raiseBudget", gracefulShutdown: true })).status, 400);
  const oversized = await postJson<ApiErrorBody>(url, {
    expectedRevision: 0,
    change: { type: "removeAgent", name: "x".repeat(70_000) },
  });
  assert.equal(oversized.status, 400);
  assert.match(oversized.body.message, /larger/);
  assert.deepEqual((await getJson<RuntimeConfigurationView>(url)).body.requests, []);
});

test("a User can synchronously raise stopped budget ceilings without resetting spend or starting workers", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { swarm, url } = recordedSwarm(board);
  recordUsage(
    board.temp.db,
    swarm.id,
    "Maria",
    {
      kind: "message",
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 1.25,
      costKnown: true,
      model: "alpha",
    },
    Date.now(),
  );
  recordBudgetStop(board.temp.db, swarm.id, 1, "money", Date.now());
  endRun(board.temp.db, swarm.id, process.pid, "stopped", Date.now());
  const raised = await postJson<RuntimeConfigurationView>(url, {
    expectedRevision: 0,
    change: { type: "raiseBudget", moneyUsd: 2, timeSeconds: 120 },
  });
  assert.equal(raised.status, 200);
  assert.equal(raised.body.revision, 1);
  assert.equal(raised.body.budget?.costUsd, 1.25);
  assert.equal(raised.body.budget?.moneyUsd, 2);
  assert.equal(raised.body.budget?.timeSeconds, 120);
  assert.equal(raised.body.requests[0]?.status, "applied");
  assert.equal(board.temp.db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(swarm.id)?.status, "stopped");
  const initial = board.temp.db.sql
    .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1")
    .get(swarm.id);
  assert.ok(typeof initial?.configuration === "string" && initial.configuration.includes('"moneyUsd":1'));
  assert.equal((await postJson(url, { expectedRevision: 1, change: { type: "addAgents", count: 1 } })).status, 409);
  assert.equal(
    (await postJson(url, { expectedRevision: 0, change: { type: "raiseBudget", moneyUsd: 3 } })).status,
    409,
  );
});

test("Config HTTP lowers ceilings and limits unlimited work without resetting usage", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  for (const starting of [1, null]) {
    const { swarm, url } = recordedSwarm(board, ["Maria"], {
      moneyUsd: starting,
      timeSeconds: starting === null ? null : 60,
      gracefulShutdown: true,
    });
    recordUsage(
      board.temp.db,
      swarm.id,
      "Maria",
      { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.75, model: "alpha" },
      Date.now(),
    );
    const result = await postJson<RuntimeConfigurationView>(url, {
      expectedRevision: 0,
      change: { type: "raiseBudget", moneyUsd: 0.5, timeSeconds: 30 },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.revision, 1);
    assert.equal(result.body.budget?.moneyUsd, 0.5);
    assert.equal(result.body.budget?.timeSeconds, 30);
    assert.equal(result.body.budget?.costUsd, 0.75);
    assert.equal(result.body.budget?.exhausted, "money");
    assert.equal(result.body.budget?.gracefulShutdown, true);
    assert.equal(result.body.requests[0]?.status, "applied");
    assert.equal(result.body.configuration?.effective.workers.length, 1);
    assert.equal(
      (await postJson(url, { expectedRevision: 0, change: { type: "raiseBudget", moneyUsd: 0.2 } })).status,
      409,
    );
  }
});

test("Config HTTP fences a stale editor across resume even when both runs have revision zero", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { swarm, url } = recordedSwarm(board);
  const initial = (await getJson<RuntimeConfigurationView>(url)).body.configuration;
  assert.ok(initial);
  endRun(board.temp.db, swarm.id, process.pid, "stopped", Date.now());
  const resumed = beginResume(board.temp.db, swarm.id, process.pid, Date.now());
  saveRunConfiguration(board.temp.db, swarm.id, resumed.run, initial.effective, Date.now());
  const current = (await getJson<RuntimeConfigurationView>(url)).body;
  assert.equal(current.run, 2);
  assert.equal(current.revision, 0);
  for (const change of [
    { type: "addAgents", count: 1 },
    { type: "raiseBudget", moneyUsd: 2 },
  ]) {
    const stale = await postJson<ApiErrorBody>(url, { expectedRun: 1, expectedRevision: 0, change });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /run changed|refresh/i);
  }
  assert.deepEqual((await getJson<RuntimeConfigurationView>(url)).body.requests, []);
  const fresh = await postJson<RuntimeConfigurationView>(url, {
    expectedRun: 2,
    expectedRevision: 0,
    change: { type: "addAgents", count: 1 },
  });
  assert.equal(fresh.status, 202);
  assert.equal(fresh.body.requests[0]?.run, 2);
});

test("Config HTTP reports absent historical metadata honestly rather than inventing an editable configuration", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${swarm.id}/config`;
  const historical = (await getJson<RuntimeConfigurationView>(url)).body;
  assert.equal(historical.configuration, null);
  assert.equal(historical.budget, null);
  assert.equal((await postJson(url, { expectedRevision: 0, change: { type: "addAgents", count: 1 } })).status, 409);
});

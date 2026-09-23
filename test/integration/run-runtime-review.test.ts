import assert from "node:assert/strict";
import { test } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { ownsActiveRun } from "../../src/broker/active-ownership.js";
import { sweepStaleRuns } from "../../src/broker/swarms.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  recipientStatus,
  spawnsOf,
  isAlive,
  waitFor,
  promptTexts,
} from "./run-fixture.js";

test("terminal error leaving accepted steering unread recovers once and finishes", { timeout: 15_000 }, async (t) => {
  const run = createRunFixture({ retainQueueOnError: true, runs: [[{ type: "tool", ms: 700 }], [{ type: "reply" }]] });
  t.after(async () => {
    await stopAllRuns();
    run.cleanup();
  });
  const result = startSwarm(run.env, { name: "unread", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "working", "working");
  const message = sendMessage(run.db, id, "User", [name], "must not be lost", Date.now());
  await waitFor(() => recipientStatus(run.db, message.id, name) === "delivered", "accepted steer");
  assert.equal((await result).end, "finished");
  assert.equal(recipientStatus(run.db, message.id, name), "read");
  assert.equal(run.fake.log().filter((record) => record.type === "clear_queue").length, 1);
  assert.equal(promptTexts(run.fake).filter((text) => text.includes(`[swarm message #${message.id}]`)).length, 2);
  assert.equal(spawnsOf(run.fake).length, 1);
});

test("closed DB in a timer stops processes and rejects the run, not the host", { timeout: 15_000 }, async (t) => {
  const run = createRunFixture(SCENARIOS.settle, { timings: { completionGraceMs: 60_000 } });
  const handle = openSwarmDb(run.db.path, { create: false });
  run.env.db = handle;
  t.after(async () => {
    await stopAllRuns();
    run.cleanup();
  });
  const result = startSwarm(run.env, { name: "closed", taskPrompt: "Work.", agentAmount: 1 }, {});
  const rejected = assert.rejects(result);
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "idle", "idle");
  const [child] = spawnsOf(run.fake);
  handle.close();
  await rejected;
  assert.equal(isAlive(child.pid), false);
  assert.equal(ownsActiveRun(run.db, id, process.pid), false);
  assert.ok(run.notes.some((text) => text.includes("could not persist")));
});

test("write failure in supervisor callbacks stops processes and cleans up once", { timeout: 15_000 }, async (t) => {
  const run = createRunFixture(SCENARIOS.longTool(700), {
    timings: { completionGraceMs: 60_000, heartbeatMs: 60_000 },
  });
  const original = run.db.write;
  t.after(async () => {
    run.db.write = original;
    await stopAllRuns();
    run.cleanup();
  });
  const result = startSwarm(run.env, { name: "write", taskPrompt: "Work.", agentAmount: 1 }, {});
  const rejected = assert.rejects(result, /injected write failure/);
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "working", "working");
  let failures = 0;
  run.db.write = () => {
    failures++;
    throw new Error("injected write failure");
  };
  await rejected;
  assert.ok(failures <= 3, "one failure and bounded cleanup, no retry loop");
  assert.ok(spawnsOf(run.fake).every((child) => !isAlive(child.pid)));
});

test("revive timer persistence failure settles instead of escaping its promise", { timeout: 15_000 }, async (t) => {
  const run = createRunFixture(SCENARIOS.crash, { timings: { heartbeatMs: 60_000, reviveBackoffMs: [500] } });
  const original = run.db.write;
  t.after(async () => {
    run.db.write = original;
    await stopAllRuns();
    run.cleanup();
  });
  const result = startSwarm(run.env, { name: "revive failure", taskPrompt: "Work.", agentAmount: 1 }, {});
  const rejected = assert.rejects(result, /revive write failed/);
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "crashed", "crashed before revive");
  run.db.write = () => {
    throw new Error("revive write failed");
  };
  await rejected;
  assert.equal(spawnsOf(run.fake).length, 1);
  assert.equal(ownsActiveRun(run.db, id, process.pid), false);
});

test("constructor failure after createSwarm releases the run lock", async (t) => {
  const run = createRunFixture(SCENARIOS.settle);
  t.after(() => run.cleanup());
  const env = {
    ...run.env,
    get launch(): never {
      throw new Error("constructor failure");
    },
  };
  await assert.rejects(
    startSwarm(env, { name: "broken", taskPrompt: "Work.", agentAmount: 1 }, {}),
    /constructor failure/,
  );
  const id = newestSwarmId(run.db);
  assert.equal(getSwarm(run.db, id, Date.now())?.status, "stopped");
  assert.equal(ownsActiveRun(run.db, id, process.pid), false);
  assert.equal(spawnsOf(run.fake).length, 0);
});

test("owned active run survives a self-stale sweep after suspension", { timeout: 15_000 }, async (t) => {
  const run = createRunFixture(SCENARIOS.settle, { timings: { completionGraceMs: 60_000 } });
  t.after(async () => {
    await stopAllRuns();
    run.cleanup();
  });
  const result = startSwarm(run.env, { name: "paused", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  assert.equal(ownsActiveRun(run.db, id, process.pid), true);
  assert.deepEqual(
    sweepStaleRuns(run.db, Date.now() + 60_000, undefined, (swarmId, pid) => ownsActiveRun(run.db, swarmId, pid)),
    [],
  );
  await stopAllRuns();
  assert.equal((await result).end, "stopped");
  assert.equal(ownsActiveRun(run.db, id, process.pid), false);
});

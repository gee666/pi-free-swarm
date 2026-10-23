import assert from "node:assert/strict";
import { test } from "node:test";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { requireIdleWorker, workerHasIdled } from "../../src/broker/worker-eligibility.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("idle-only actions require genuine first idle and retain eligibility across worker recovery", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    assert.equal(workerHasIdled(temp.db, swarm.id, "Maria"), false);
    setAgentStatus(temp.db, swarm.id, "Maria", "working", T0);
    assert.throws(() => requireIdleWorker(temp.db, swarm.id, "Maria"), /first idle/);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0 + 1);
    assert.equal(requireIdleWorker(temp.db, swarm.id, "maria"), "Maria");
    setAgentStatus(temp.db, swarm.id, "Maria", "crashed", T0 + 2);
    setAgentStatus(temp.db, swarm.id, "Maria", "starting", T0 + 3);
    assert.equal(workerHasIdled(temp.db, swarm.id, "Maria"), true);
    assert.equal(workerHasIdled(temp.db, swarm.id, "John"), false);
    const other = seedSwarm(temp.db);
    assert.equal(workerHasIdled(temp.db, other.id, "Maria"), false);
  } finally {
    temp.cleanup();
  }
});

test("retired identities and nonworkers cannot regain idle-only actions", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0);
    temp.db.sql
      .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?")
      .run(T0 + 1, swarm.id, "Maria");
    assert.equal(workerHasIdled(temp.db, swarm.id, "Maria"), false);
    assert.throws(() => requireIdleWorker(temp.db, swarm.id, "Maria"), /active workers/);
    for (const name of ["Watcher", "User", "Main"]) {
      assert.equal(workerHasIdled(temp.db, swarm.id, name), false);
      assert.throws(() => requireIdleWorker(temp.db, swarm.id, name), /Only worker agents/);
    }
  } finally {
    temp.cleanup();
  }
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { recordUsage, setAgentStatus } from "../../src/broker/agent-state.js";
import { beginResume, endRun, sweepStaleRuns } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { readBudget } from "../../src/store/budget.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const policy = { budgetTimeSeconds: 60 };

it("does not bill delayed dead-owner discovery as active time and retains cumulative time on resume", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  temp.db.sql.prepare("UPDATE swarms SET runner_heartbeat_at = ? WHERE id = ?").run(T0 + 1000, swarm.id);
  assert.deepEqual(
    sweepStaleRuns(temp.db, T0 + DAY_MS, () => false),
    [swarm.id],
  );
  const stopped = readBudget(temp.db, swarm.id, policy, T0 + DAY_MS);
  assert.equal(stopped.activeTimeMs, 1000, "unknown downtime is not reported as known execution");
  assert.equal(stopped.exhausted, null);
  assert.equal(stopped.hasInterruptedRuns, true);
  assert.match(stopped.accounting, /unobserved final interval/);
  assert.equal(
    getSwarm(temp.db, swarm.id, T0 + DAY_MS)?.finishedAt,
    T0 + DAY_MS,
    "discovery time remains visible separately",
  );
  assert.equal(readBudget(temp.db, swarm.id, policy, T0 + DAY_MS + 5000).activeTimeMs, 1000);
  beginResume(temp.db, swarm.id, process.pid, T0 + 2 * DAY_MS);
  const resumed = readBudget(temp.db, swarm.id, policy, T0 + 2 * DAY_MS + 500);
  assert.equal(
    resumed.activeTimeMs,
    1500,
    "resume adds current activity rather than resetting or charging stopped intervals",
  );
  assert.equal(resumed.exhausted, null);
  assert.equal(resumed.hasInterruptedRuns, true, "resume keeps the historical uncertainty visible");
});

it("uses known current-run worker activity after the heartbeat, not a later Human wall write", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  setAgentStatus(temp.db, swarm.id, "Maria", "working", T0 + 500);
  setAgentStatus(temp.db, swarm.id, "John", "working", T0 + 1500);
  recordUsage(
    temp.db,
    swarm.id,
    "John",
    { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1, model: null },
    T0 + 2000,
  );
  temp.db.sql.prepare("UPDATE swarms SET runner_heartbeat_at = ? WHERE id = ?").run(T0 + 1000, swarm.id);
  createPost(
    temp.db,
    swarm.id,
    "User",
    { title: "offline follow-up", text: "This does not prove active execution." },
    T0 + DAY_MS - 1,
  );
  sweepStaleRuns(temp.db, T0 + DAY_MS, () => false);
  const budget = readBudget(temp.db, swarm.id, policy, T0 + DAY_MS);
  assert.equal(budget.activeTimeMs, 2000);
  assert.equal(budget.costUsd, 0.1);
  const stats = getStats(temp.db, swarm.id, T0 + DAY_MS);
  assert.equal(stats?.agents.find((agent) => agent.name === "Maria")?.activeTimeMs, 1500);
  assert.equal(stats?.agents.find((agent) => agent.name === "John")?.activeTimeMs, 500);
  const negative = temp.db.sql
    .prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE swarm_id = ? AND ended_at < started_at")
    .get(swarm.id);
  assert.equal(negative?.n, 0);
});

it("keeps clean shutdown duration authoritative rather than truncating it to an earlier heartbeat", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  setAgentStatus(temp.db, swarm.id, "Maria", "working", T0 + 500);
  temp.db.sql.prepare("UPDATE swarms SET runner_heartbeat_at = ? WHERE id = ?").run(T0 + 1000, swarm.id);
  endRun(temp.db, swarm.id, process.pid, "stopped", T0 + 10000, 1);
  const clean = readBudget(temp.db, swarm.id, policy, T0 + DAY_MS);
  assert.equal(clean.activeTimeMs, 10000);
  assert.equal(clean.hasInterruptedRuns, false);
  assert.doesNotMatch(clean.accounting, /unobserved final interval/);
  assert.equal(
    getStats(temp.db, swarm.id, T0 + DAY_MS)?.agents.find((agent) => agent.name === "Maria")?.activeTimeMs,
    9500,
  );
});

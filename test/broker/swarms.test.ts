import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { ParticipantView } from "../../src/api-types.js";
import { incrementReviveCount, recordUsage, setAgentActivity, setAgentStatus } from "../../src/broker/agent-state.js";
import { markDelivered } from "../../src/broker/delivery-state.js";
import { BrokerError } from "../../src/broker/errors.js";
import { sendMessage } from "../../src/broker/messages.js";
import { beginResume, createSwarm, endRun, markSwarmRunning, sweepStaleRuns } from "../../src/broker/swarms.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { buildAgentEnv, loadSettings } from "../../src/settings.js";
import { getMessages, getThread } from "../../src/store/message-queries.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getSwarm, listAgentSessions, listParticipants, listSwarms } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
// A live process that is not us: the "other pi process".
const OTHER_PID = process.ppid;

function agents(swarmId: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const p of listParticipants(db, swarmId)) if (p.kind === "agent") result[p.name] = p.status;
  return result;
}

function agent(swarmId: number, name: string): Extract<ParticipantView, { kind: "agent" }> | undefined {
  return listParticipants(db, swarmId).find(
    (p): p is Extract<ParticipantView, { kind: "agent" }> => p.name === name && p.kind === "agent",
  );
}

describe("createSwarm", () => {
  it("creates a starting swarm locked by the runner with its participants", () => {
    const swarm = seedSwarm(db, { name: "  auth-refactor " });
    assert.equal(swarm.name, "auth-refactor");
    assert.equal(swarm.status, "starting");
    assert.equal(swarm.acceptsMessages, true);
    assert.equal(swarm.runnerPid, process.pid);
    assert.equal(swarm.agentAmount, 3);
    assert.equal(swarm.runCount, 1);
    assert.deepEqual(
      listParticipants(db, swarm.id).map((p) => p.name),
      ["User", "Maria", "John", "Liam"],
    );
    assert.deepEqual(listAgentSessions(db, swarm.id)[0], {
      name: "Maria",
      sessionFile: `${db.dataDir}/sessions/${swarm.id}/Maria/session.jsonl`,
    });
    markSwarmRunning(db, swarm.id, OTHER_PID, T0);
    assert.equal(getSwarm(db, swarm.id, T0)?.status, "starting", "only the runner marks it running");
    markSwarmRunning(db, swarm.id, process.pid, T0);
    assert.equal(getSwarm(db, swarm.id, T0)?.status, "running");
  });

  it("validates the swarm name", () => {
    const create = (name: string) =>
      createSwarm(db, { name, taskPrompt: "t", agentNames: ["A"], runnerPid: process.pid, now: T0 });
    assert.throws(() => create(" "), new BrokerError("validation", "swarm_name is empty.", "swarm_name"));
    assert.throws(() => create("n".repeat(72)), { message: "swarm_name too long: 72/60 characters." });
  });

  it("resolves a stale lock as interrupted on read", () => {
    const swarm = seedSwarm(db);
    const later = T0 + 21_000;
    assert.deepEqual(
      [getSwarm(db, swarm.id, later)?.status, getSwarm(db, swarm.id, later)?.acceptsMessages],
      ["interrupted", false],
    );
    assert.equal(getSwarm(db, swarm.id, T0, () => false)?.status, "interrupted");
    assert.ok(listSwarms(db, T0).every((s, i, all) => i === 0 || all[i - 1].id > s.id));
  });
});

describe("settings env", () => {
  it("never reaches the database", () => {
    const secret = "postgres://admin:hunter2@db";
    writeFileSync(path.join(db.dataDir, "settings.json"), JSON.stringify({ env: { DATABASE_URL: secret } }));
    const { settings } = loadSettings(temp.cwd);
    const swarm = seedSwarm(db);
    const env = buildAgentEnv(settings, {
      dbPath: db.path,
      swarmId: swarm.id,
      agentName: "Maria",
      runnerPid: process.pid,
    });
    assert.equal(env.DATABASE_URL, secret);
    sendMessage(db, swarm.id, "Maria", ["John"], "env is set", T0);
    for (const file of [db.path, `${db.path}-wal`]) {
      if (existsSync(file)) assert.ok(!readFileSync(file).includes(secret), file);
    }
  });
});

describe("agent state", () => {
  it("tracks status, activity and work spans", () => {
    const swarm = seedSwarm(db);
    setAgentStatus(db, swarm.id, "Maria", "starting", T0);
    setAgentStatus(db, swarm.id, "Maria", "working", T0 + 1_000);
    setAgentActivity(db, swarm.id, "Maria", { kind: "tool", toolName: "bash" }, T0 + 1_100);
    assert.deepEqual(agent(swarm.id, "Maria")?.activity, { kind: "tool", toolName: "bash" });
    assert.equal(getSwarm(db, swarm.id, T0 + 1_100)?.agentsWorking, 1);
    setAgentStatus(db, swarm.id, "Maria", "idle", T0 + 4_000);
    assert.equal(agent(swarm.id, "Maria")?.activity, null);
    setAgentStatus(db, swarm.id, "Maria", "working", T0 + 5_000);
    setAgentStatus(db, swarm.id, "Maria", "crashed", T0 + 6_000);
    const spans = db.sql
      .prepare("SELECT started_at, ended_at, reason, run FROM agent_runs WHERE swarm_id = ? ORDER BY id")
      .all(swarm.id)
      .map((row) => ({ ...row }));
    assert.deepEqual(spans, [
      { started_at: T0 + 1_000, ended_at: T0 + 4_000, reason: "settled", run: 1 },
      { started_at: T0 + 5_000, ended_at: T0 + 6_000, reason: "crashed", run: 1 },
    ]);
    assert.equal(getStats(db, swarm.id, T0 + 7_000)?.agents[0].activeTimeMs, 4_000);
    assert.equal(incrementReviveCount(db, swarm.id, "maria"), 1);
    assert.equal(incrementReviveCount(db, swarm.id, "Maria"), 2);
  });

  it("counts compaction tokens and cost but not as turns", () => {
    const swarm = seedSwarm(db);
    const sample = { input: 100, output: 10, cacheRead: 5, cacheWrite: 1, cost: 0.25, model: "m" };
    recordUsage(db, swarm.id, "John", { kind: "message", ...sample }, T0);
    recordUsage(db, swarm.id, "John", { kind: "compaction", ...sample, model: null }, T0);
    const stats = getStats(db, swarm.id, T0);
    const john = stats?.agents.find((a) => a.name === "John");
    assert.deepEqual(
      john && [john.input, john.output, john.cacheRead, john.cacheWrite, john.cost, john.turns],
      [200, 20, 10, 2, 0.5, 1],
    );
    assert.equal(stats?.totals.turns, 1);
    assert.equal(agent(swarm.id, "John")?.cost, 0.5);
  });
});

describe("runs", () => {
  it("ends a stopped run: statuses, spans, lock, undeliverable and User notices", () => {
    const swarm = seedSwarm(db);
    setAgentStatus(db, swarm.id, "Maria", "working", T0);
    setAgentStatus(db, swarm.id, "John", "crashed", T0);
    const fromUser = sendMessage(db, swarm.id, "User", ["Maria", "John"], "status?", T0 + 1);
    const fromAgent = sendMessage(db, swarm.id, "Liam", ["Maria"], "ping", T0 + 1);
    markDelivered(db, swarm.id, "Maria", [fromAgent.id], T0 + 2);

    assert.equal(endRun(db, swarm.id, OTHER_PID, "stopped", T0 + 3), false);
    assert.equal(endRun(db, swarm.id, process.pid, "stopped", T0 + 3), true);

    const ended = getSwarm(db, swarm.id, T0 + 3);
    assert.deepEqual([ended?.status, ended?.runnerPid, ended?.finishedAt], ["stopped", null, T0 + 3]);
    assert.deepEqual(agents(swarm.id), { Maria: "stopped", John: "crashed", Liam: "stopped" });
    const statuses = getMessages(db, [fromUser.id, fromAgent.id]).flatMap((m) => m.recipients.map((r) => r.status));
    assert.deepEqual(statuses, ["undeliverable", "undeliverable", "undeliverable"]);
    const userThread = getThread(db, swarm.id, fromUser.threadId)?.messages ?? [];
    assert.deepEqual(
      userThread.map((m) => [m.sender, m.text]),
      [
        ["User", "status?"],
        ["System", UNDELIVERABLE_REPLY_TEXT],
      ],
    );
    assert.equal(getThread(db, swarm.id, fromAgent.threadId)?.messages.length, 1, "agents get no notice");
    const open = db.sql
      .prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE swarm_id = ? AND ended_at IS NULL")
      .get(swarm.id);
    assert.equal(open?.n, 0);
  });

  it("keeps idle and crashed statuses when finished", () => {
    const swarm = seedSwarm(db);
    setAgentStatus(db, swarm.id, "Maria", "idle", T0);
    setAgentStatus(db, swarm.id, "John", "crashed", T0);
    setAgentStatus(db, swarm.id, "Liam", "idle", T0);
    endRun(db, swarm.id, process.pid, "finished", T0 + 1);
    assert.deepEqual(agents(swarm.id), { Maria: "idle", John: "crashed", Liam: "idle" });
  });

  it("refuses to resume a running swarm and resumes a finished one", () => {
    const swarm = seedSwarm(db);
    assert.throws(
      () => beginResume(db, swarm.id, OTHER_PID, T0 + 1),
      new BrokerError("swarm_running", `Swarm #${swarm.id} is running in another pi process (pid ${process.pid}).`),
    );
    assert.throws(() => beginResume(db, swarm.id, process.pid, T0 + 1), {
      message: `Swarm #${swarm.id} is already running in this pi process.`,
    });
    assert.throws(() => beginResume(db, 9999, process.pid, T0), { message: "Swarm #9999 not found." });
    setAgentStatus(db, swarm.id, "Maria", "idle", T0);
    endRun(db, swarm.id, process.pid, "finished", T0 + 10);
    const resumed = beginResume(db, swarm.id, OTHER_PID, T0 + 20);
    assert.equal(resumed.run, 2);
    assert.deepEqual([resumed.swarm.status, resumed.swarm.runCount, resumed.swarm.finishedAt], ["starting", 2, null]);
    assert.deepEqual(agents(swarm.id), { Maria: "pending", John: "pending", Liam: "pending" });
    assert.equal(getStats(db, swarm.id, T0 + 30)?.totals.wallTimeMs, 10 + 10);
  });

  it("cleans up a stale run before resuming it", () => {
    const swarm = seedSwarm(db);
    const message = sendMessage(db, swarm.id, "User", ["Maria"], "hi", T0 + 1);
    assert.equal(getMessages(db, [message.id])[0].recipients[0].status, "pending");
    const resumed = beginResume(db, swarm.id, OTHER_PID, T0 + 30_000);
    assert.equal(resumed.swarm.status, "starting");
    assert.equal(getMessages(db, [message.id])[0].recipients[0].status, "undeliverable");
    const run1 = db.sql.prepare("SELECT end_status FROM swarm_runs WHERE swarm_id = ? AND run = 1").get(swarm.id);
    assert.equal(run1?.end_status, "interrupted");
  });

  it("sweeps only stale runs", () => {
    const fresh = seedSwarm(db, { now: T0 + 50_000 });
    const stale = seedSwarm(db, { now: T0 });
    const swept = sweepStaleRuns(db, T0 + 55_000);
    assert.ok(swept.includes(stale.id));
    assert.ok(!swept.includes(fresh.id));
    assert.equal(getSwarm(db, stale.id, T0 + 55_000)?.status, "interrupted");
    assert.deepEqual(sweepStaleRuns(db, T0 + 55_000).includes(stale.id), false);
    assert.deepEqual(sweepStaleRuns(db, T0 + 50_000, () => false).includes(fresh.id), true);
  });
});

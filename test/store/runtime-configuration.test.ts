import assert from "node:assert/strict";
import { it } from "node:test";
import type { RunConfiguration } from "../../src/run-configuration.js";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { sendMessage } from "../../src/broker/messages.js";
import { createPost } from "../../src/broker/wall.js";
import { applyRosterConfiguration, activeWorkerNames, getActiveAssignments } from "../../src/store/active-roster.js";
import { appendConfigurationRevision, ConfigurationConflictError } from "../../src/store/configuration-revisions.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getRunConfiguration, saveRunConfiguration } from "../../src/store/run-configuration.js";
import {
  claimConfigurationRequest,
  finishConfigurationRequest,
  getRuntimeConfiguration,
  listPendingConfigurationRequests,
  queueConfigurationChange,
  rejectRunConfigurationRequests,
} from "../../src/store/runtime-configuration.js";
import { getParticipant, getSwarm, listAgentSessions } from "../../src/store/swarm-queries.js";
import { getStats } from "../../src/store/stats-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function fixture(names = ["Maria", "John", "Liam"]) {
  const temp = createTempDb();
  const swarm = seedSwarm(temp.db, { agents: names });
  const configuration: RunConfiguration = {
    version: 1,
    workers: names.map((name) => ({ name, provider: "fixture", modelId: "one", thinkingLevel: "high" })),
    launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
    timing: {
      staggerSeconds: 0,
      idleReminderDelay: 100,
      idleReminderDigestSize: 4,
      heartbeatMs: 1,
      deliveryPollMs: 2,
      completionCheckMs: 3,
      progressMs: 4,
      resumeStaggerMs: 5,
      reviveBackoffMs: [1],
    },
    limits: { maxRpcFrameBytes: 1000000 },
    budget: { moneyUsd: 2, timeSeconds: 100, gracefulShutdown: false },
  };
  saveRunConfiguration(temp.db, swarm.id, 1, configuration, T0);
  return { ...temp, swarm, configuration };
}

it("archives workers with immutable initial provenance, retained messages and deliberate historical access", (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  setAgentStatus(f.db, f.swarm.id, "Maria", "working", T0);
  const pending = sendMessage(f.db, { swarmId: f.swarm.id, from: "John", to: "Maria", text: "pending work", now: T0 });
  const request = queueConfigurationChange(f.db, f.swarm.id, "User", { type: "removeAgent", name: "maria" }, 0, T0 + 1);
  assert.deepEqual(request.change, { type: "removeAgent", name: "Maria" });
  assert.equal(claimConfigurationRequest(f.db, request.id, process.pid, T0 + 2).status, "applying");
  const next = { ...f.configuration, workers: f.configuration.workers.filter((worker) => worker.name !== "Maria") };
  f.db.write(() => {
    applyRosterConfiguration(f.db, f.swarm.id, 1, next, 0, T0 + 3);
  });
  assert.equal(
    getRuntimeConfiguration(f.db, f.swarm.id, T0 + 3)?.requests[0]?.status,
    "applying",
    "DB staging alone does not claim joined process cleanup",
  );
  finishConfigurationRequest(f.db, request.id, "applied", null, T0 + 4);
  assert.deepEqual(activeWorkerNames(f.db, f.swarm.id), ["John", "Liam"]);
  assert.deepEqual(getActiveAssignments(f.db, f.swarm.id), next.workers);
  const retired = getParticipant(f.db, f.swarm.id, "Maria");
  assert.equal(retired?.kind === "agent" && retired.status, "retired");
  assert.deepEqual(retired?.kind === "agent" && retired.model, f.configuration.workers[0]);
  assert.equal(getRunConfiguration(f.db, f.swarm.id)?.revision, 1);
  assert.equal(getStats(f.db, f.swarm.id, T0 + 1000)?.agents.find((agent) => agent.name === "Maria")?.activeTimeMs, 3);
  assert.equal(
    getStats(f.db, f.swarm.id, T0 + 1000)?.agents.find((agent) => agent.name === "Maria")?.status,
    "retired",
  );
  assert.equal(
    JSON.parse(
      String(
        f.db.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ?").get(f.swarm.id)
          ?.configuration,
      ),
    ).workers.length,
    3,
  );
  assert.equal(
    f.db.sql.prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'Maria'").get(pending.id)
      ?.status,
    "pending",
  );
  assert.ok(listAgentSessions(f.db, f.swarm.id).some((agent) => agent.name === "Maria"));
  assert.equal(
    listAgentSessions(f.db, f.swarm.id, { activeOnly: true }).some((agent) => agent.name === "Maria"),
    false,
  );
  assert.throws(
    () => sendMessage(f.db, { swarmId: f.swarm.id, from: "John", to: "Maria", text: "new", now: T0 + 5 }),
    /retired/,
  );
  assert.throws(() => createPost(f.db, f.swarm.id, "Maria", { title: "late", text: "late" }, T0 + 5), /retired/);
});

it("joins roster, revision, electorate and request writes in one rollback without leaking outbox rows", (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  const count = Number(f.db.sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n);
  const next = {
    ...f.configuration,
    workers: [...f.configuration.workers, { name: "Nora", provider: "fixture", modelId: "one", thinkingLevel: "high" }],
  };

  assert.throws(
    () =>
      f.db.write(() => {
        applyRosterConfiguration(f.db, f.swarm.id, 1, next, 0, T0);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(getRunConfiguration(f.db, f.swarm.id)?.revision, undefined);
  assert.deepEqual(activeWorkerNames(f.db, f.swarm.id), ["Maria", "John", "Liam"]);
  assert.equal(getParticipant(f.db, f.swarm.id, "Nora"), null);
  assert.equal(getRuntimeConfiguration(f.db, f.swarm.id, T0)?.requests.length, 0);
  assert.equal(Number(f.db.sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n), count);
});

it("uses revision and owner fences across concurrent handles and retains uncertain applying requests after run replacement", (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  const second = openSwarmDb(f.db.path, { create: false });
  t.after(() => second.close());
  const first = queueConfigurationChange(f.db, f.swarm.id, "User", { type: "addAgents", count: 1 }, 0, T0);
  const other = queueConfigurationChange(second, f.swarm.id, "User", { type: "removeAgent", name: "John" }, 0, T0);
  assert.deepEqual(
    listPendingConfigurationRequests(second, f.swarm.id, 1).map((request) => request.id),
    [first.id, other.id],
  );
  claimConfigurationRequest(f.db, first.id, process.pid, T0 + 1);
  assert.throws(() => claimConfigurationRequest(second, first.id, process.pid, T0 + 1), /already started/);
  appendConfigurationRevision(f.db, f.swarm.id, 1, f.configuration, 0, T0 + 1);
  assert.throws(() => claimConfigurationRequest(second, other.id, process.pid, T0 + 1), /Configuration changed/);
  f.db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(f.swarm.id);
  assert.throws(() => finishConfigurationRequest(f.db, first.id, "applied", null, T0 + 2), /owner changed/);
  const history = getRuntimeConfiguration(second, f.swarm.id, T0 + 2);
  assert.equal(history?.configuration, null);
  assert.equal(history?.requests.find((request) => request.id === first.id)?.status, "applying");
  assert.equal(history?.requests.find((request) => request.id === other.id)?.status, "pending");
  assert.equal(rejectRunConfigurationRequests(f.db, f.swarm.id, 1, T0 + 3), 2);
  const closed = getRuntimeConfiguration(second, f.swarm.id, T0 + 3);
  assert.match(closed?.requests.find((request) => request.id === first.id)?.error ?? "", /possible partial effects/);
  assert.match(closed?.requests.find((request) => request.id === other.id)?.error ?? "", /before this control started/);
  assert.equal(rejectRunConfigurationRequests(f.db, f.swarm.id, 1, T0 + 4), 0);
  saveRunConfiguration(f.db, f.swarm.id, 2, f.configuration, T0 + 4);
  assert.throws(
    () => queueConfigurationChange(f.db, f.swarm.id, "User", { type: "addAgents", count: 1 }, 0, T0 + 4, 1),
    /run changed/,
  );
  assert.equal(listPendingConfigurationRequests(f.db, f.swarm.id, 2).length, 0);
});

it("rejects last removal, retired identity reuse, changed retained models and path-like names without partial revisions", (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  const next = { ...f.configuration, workers: f.configuration.workers.filter((worker) => worker.name !== "Maria") };
  applyRosterConfiguration(f.db, f.swarm.id, 1, next, 0, T0);
  assert.throws(() => applyRosterConfiguration(f.db, f.swarm.id, 1, f.configuration, 1, T0), /cannot be reused/);
  assert.throws(() => applyRosterConfiguration(f.db, f.swarm.id, 1, { ...next, workers: [] }, 1, T0), /at least one/);
  assert.throws(
    () =>
      applyRosterConfiguration(
        f.db,
        f.swarm.id,
        1,
        { ...next, workers: next.workers.map((worker) => ({ ...worker, modelId: "other" })) },
        1,
        T0,
      ),
    /keeps its recorded/,
  );
  assert.throws(
    () =>
      applyRosterConfiguration(
        f.db,
        f.swarm.id,
        1,
        {
          ...next,
          workers: [...next.workers, { name: "../outside", provider: "fixture", modelId: "one", thinkingLevel: null }],
        },
        1,
        T0,
      ),
    /Worker names/,
  );
  assert.equal(getRunConfiguration(f.db, f.swarm.id)?.revision, 1);
  const single = fixture(["Maria"]);
  t.after(() => single.cleanup());
  assert.throws(
    () => queueConfigurationChange(single.db, single.swarm.id, "User", { type: "removeAgent", name: "Maria" }, 0, T0),
    /at least one/,
  );
});

it("atomically replaces a sole worker with a fresh assignment and exposes effective budget revisions", (t) => {
  const f = fixture(["Maria"]);
  t.after(() => f.cleanup());
  setAgentStatus(f.db, f.swarm.id, "Maria", "idle", T0);
  const next = {
    ...f.configuration,
    workers: [{ name: "Nora", provider: "fixture", modelId: "one", thinkingLevel: "high" }],
  };
  f.db.write(() => {
    applyRosterConfiguration(f.db, f.swarm.id, 1, next, 0, T0 + 1);
  });
  assert.deepEqual(activeWorkerNames(f.db, f.swarm.id), ["Nora"]);
  const fresh = getParticipant(f.db, f.swarm.id, "Nora");
  assert.equal(fresh?.kind === "agent" && fresh.firstIdleAt, null);
  assert.deepEqual(fresh?.kind === "agent" && fresh.model, next.workers[0]);
  assert.equal(getSwarm(f.db, f.swarm.id, T0 + 1)?.agentAmount, 1);
  const raised = { ...next, budget: { ...next.budget, moneyUsd: 10 } };
  appendConfigurationRevision(f.db, f.swarm.id, 1, raised, 1, T0 + 2);
  assert.equal(getSwarm(f.db, f.swarm.id, T0 + 2)?.budget?.moneyUsd, 10);
  assert.equal(getSwarm(f.db, f.swarm.id, T0 + 2)?.configuration?.revision, 2);
});

it("rejects stale lock owners and requires genuine first idle before self-retirement", (t) => {
  const f = fixture();
  t.after(() => f.cleanup());
  assert.throws(
    () =>
      queueConfigurationChange(
        f.db,
        f.swarm.id,
        "Maria",
        { type: "retireAgent", name: "Maria", handoffFile: "handoff.md" },
        0,
        T0,
      ),
    /genuine idle/,
  );
  setAgentStatus(f.db, f.swarm.id, "Maria", "idle", T0);
  assert.throws(
    () =>
      queueConfigurationChange(
        f.db,
        f.swarm.id,
        "John",
        { type: "retireAgent", name: "Maria", handoffFile: "handoff.md" },
        0,
        T0,
      ),
    /only itself/,
  );
  const request = queueConfigurationChange(
    f.db,
    f.swarm.id,
    "Maria",
    { type: "retireAgent", name: "Maria", handoffFile: "handoff.md" },
    0,
    T0,
  );
  f.db.sql.prepare("UPDATE swarms SET runner_heartbeat_at = 0 WHERE id = ?").run(f.swarm.id);
  assert.throws(() => claimConfigurationRequest(f.db, request.id, process.pid, T0), ConfigurationConflictError);
  assert.throws(() => applyRosterConfiguration(f.db, f.swarm.id, 1, f.configuration, 0, T0), /current live run owner/);
});

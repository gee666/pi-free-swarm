import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { createTask } from "../../src/broker/tasks.js";
import { listCriteria } from "../../src/store/criteria.js";
import { requestRetirement } from "../../src/broker/retirement.js";
import { endRun } from "../../src/broker/swarms.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import { claimConfigurationRequest, listPendingConfigurationRequests } from "../../src/store/runtime-configuration.js";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { AGENT_TOOL, WATCHER_NAME } from "../../src/constants.js";
import { Value } from "typebox/value";
import { openSwarmDb, type SwarmDb } from "../../src/store/db.js";
import { createRetirementTool } from "../../src/tools/retirement-tool.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
function fixture(database: SwarmDb = db) {
  const swarm = seedSwarm(database, { agents: ["Maria", "John"] });
  saveRunConfiguration(
    database,
    swarm.id,
    1,
    {
      version: 1,
      workers: ["Maria", "John"].map((name) => ({
        name,
        provider: "fixture",
        modelId: "alpha",
        thinkingLevel: "high",
      })),
      launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
      timing: {
        staggerSeconds: 0,
        idleReminderDelay: 100,
        heartbeatMs: 1,
        deliveryPollMs: 2,
        completionCheckMs: 3,
        progressMs: 4,
        resumeStaggerMs: 5,
        reviveBackoffMs: [1, 2],
      },
      limits: { maxRpcFrameBytes: 1000000 },
      budget: { moneyUsd: null, timeSeconds: null, gracefulShutdown: false },
    },
    T0,
  );
  return swarm;
}

test("one retire call writes exact self-authored handoff and queues a fenced replacement, not immediate roster edits", () => {
  const swarm = fixture();
  const now = T0 + 1000;
  setAgentStatus(db, swarm.id, "Maria", "idle", now - 1);
  setAgentStatus(db, swarm.id, "Maria", "working", now);
  const handoff =
    "  Finished Unicode work 🙂.\nEvidence: docs/result.md\nNext: verify the pending change.\nExternal write outcome uncertain.  ";
  const tools = createAgentToolHandlers({
    getDb: () => db,
    swarmId: swarm.id,
    run: 1,
    agentName: "Maria",
    clock: { now: () => now, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
  });
  const result = tools.retire({ handoff });
  const requests = listPendingConfigurationRequests(db, swarm.id, 1);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.change.type, "retireAgent");
  if (request.change.type !== "retireAgent") throw new Error("Expected retirement request");
  assert.equal(request.requestedBy, "Maria");
  assert.equal(request.change.name, "Maria");
  assert.equal(request.expectedRevision, 0);
  assert.match(request.change.handoffFile, /^handoffs[/\\]/);
  assert.equal(readFileSync(path.join(db.dataDir, request.change.handoffFile), "utf8"), handoff);
  assert.match(result, new RegExp(`Replacement request #${request.id} queued`));
  assert.ok(result.includes(request.change.handoffFile));
  assert.equal(
    db.sql.prepare("SELECT retired_at FROM participants WHERE swarm_id = ? AND name = 'Maria'").get(swarm.id)
      ?.retired_at,
    null,
  );
  assert.equal(
    db.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM criterion_votes v JOIN criteria c ON c.id = v.criterion_id WHERE c.swarm_id = ?",
      )
      .get(swarm.id)?.n,
    0,
  );
  assert.equal(
    db.sql
      .prepare("SELECT COUNT(*) AS n FROM participants WHERE swarm_id = ? AND kind = 'agent' AND name <> 'Watcher'")
      .get(swarm.id)?.n,
    2,
  );
  assert.throws(() => tools.retire({ handoff: "Do not duplicate." }), /already pending/);
  claimConfigurationRequest(db, request.id, process.pid, now);
  assert.throws(() => tools.retire({ handoff: "Still not a second replacement." }), /already pending/);
  assert.equal(readdirSync(path.dirname(path.join(db.dataDir, request.change.handoffFile))).length, 1);
});

test("retirement is allowed before the first idle turn when there are no obligations", () => {
  const swarm = fixture();
  const result = requestRetirement(db, swarm.id, "Maria", 1, "No open work; ready for a fresh context.", T0 + 1);
  assert.ok(existsSync(result.handoffPath));
  assert.equal(listPendingConfigurationRequests(db, swarm.id, 1).length, 1);
  assert.equal(
    db.sql.prepare("SELECT first_idle_at FROM participants WHERE swarm_id = ? AND name = 'Maria'").get(swarm.id)
      ?.first_idle_at,
    null,
  );
});

test("retirement lists every owned obligation and makes no handoff or request until they are finished", () => {
  const swarm = fixture();
  const [criterion] = listCriteria(db, swarm.id);
  assert.ok(criterion);
  const ids = ["claimed", "in_progress", "review"].map((status) => {
    const task = createTask(db, {
      swarmId: swarm.id,
      actor: "Maria",
      now: T0 + 1,
      title: status,
      body: "Owned work",
      criteria: [{ criterionId: criterion.id, contribution: "Work" }],
      claim: true,
    });
    db.sql.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, task.id);
    return task.id;
  });
  assert.throws(() => requestRetirement(db, swarm.id, "Maria", 1, "Not ready.", T0 + 2), {
    message: `Finish, release or hand off ${ids.map((id) => `#${id}`).join(", ")} before retiring.`,
  });
  assert.equal(existsSync(path.join(db.dataDir, "handoffs", String(swarm.id))), false);
  assert.equal(listPendingConfigurationRequests(db, swarm.id, 1).length, 0);
  db.sql.prepare("UPDATE tasks SET status = 'accepted' WHERE swarm_id = ? AND owner = 'Maria'").run(swarm.id);
  assert.doesNotThrow(() => requestRetirement(db, swarm.id, "Maria", 1, "Work finished.", T0 + 3));
});

test("empty handoff, ineligible actors, stale run and ended swarm reject before writing handoff files", () => {
  const swarm = fixture();
  const now = T0 + 1000;
  for (const name of ["User", WATCHER_NAME]) {
    assert.throws(() => requestRetirement(db, swarm.id, name, 1, "Summary", now), /idle|worker/i);
  }
  setAgentStatus(db, swarm.id, "Maria", "idle", now);
  assert.throws(() => requestRetirement(db, swarm.id, "Maria", 1, " \n\t", now), /handoff must/);
  assert.throws(() => requestRetirement(db, swarm.id, "Maria", 2, "Summary", now), /older run/);
  endRun(db, swarm.id, process.pid, "stopped", now, 1);
  assert.throws(() => requestRetirement(db, swarm.id, "Maria", 1, "Summary", now), /not admitting/);
  assert.equal(existsSync(path.join(db.dataDir, "handoffs", String(swarm.id))), false);
  assert.equal(listPendingConfigurationRequests(db, swarm.id, 1).length, 0);
});

test("handoff write failure never queues a retirement request", () => {
  const isolated = createTempDb();
  try {
    const swarm = fixture(isolated.db);
    setAgentStatus(isolated.db, swarm.id, "Maria", "idle", T0 + 1);
    writeFileSync(path.join(isolated.db.dataDir, "handoffs"), "not a directory");
    assert.throws(() => requestRetirement(isolated.db, swarm.id, "Maria", 1, "Summary", T0 + 1000));
    assert.equal(listPendingConfigurationRequests(isolated.db, swarm.id, 1).length, 0);
  } finally {
    isolated.cleanup();
  }
});

test("retirement reports the actual handoff path when the agent uses a custom database location", () => {
  const isolated = createTempDb();
  const custom = openSwarmDb(path.join(isolated.cwd, "custom data", "runtime.sqlite"), { create: true });
  try {
    const swarm = fixture(custom);
    const now = T0 + 1000;
    setAgentStatus(custom, swarm.id, "Maria", "idle", now);
    const tools = createAgentToolHandlers({
      getDb: () => custom,
      swarmId: swarm.id,
      run: 1,
      agentName: "Maria",
      clock: { now: () => now, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
    });
    const result = tools.retire({ handoff: "Saved outside the default data directory." });
    const [request] = listPendingConfigurationRequests(custom, swarm.id, 1);
    assert.equal(request.change.type, "retireAgent");
    if (request.change.type !== "retireAgent") throw new Error("Expected retirement request");
    const absolute = path.join(custom.dataDir, request.change.handoffFile);
    assert.ok(result.includes(`\`${absolute}\``));
    assert.equal(readFileSync(absolute, "utf8"), "Saved outside the default data directory.");
  } finally {
    custom.close();
    isolated.cleanup();
  }
});

test("retire schema accepts handoff text only, not a filename, target identity or empty summary", () => {
  const swarm = fixture();
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria" });
  const tool = pi.tool(AGENT_TOOL.retire);
  assert.ok(Value.Check(tool.parameters, { handoff: "Completed work; remaining verification." }));
  assert.equal(Value.Check(tool.parameters, { handoff: " " }), false);
  assert.equal(Value.Check(tool.parameters, { handoffFile: "/arbitrary/file" }), false);
  assert.equal(Value.Check(tool.parameters, { handoff: "Summary", name: "John" }), false);
  assert.match(tool.description, /Available from the start/);
  assert.match(tool.description, /one large task or a few small ones/);
  assert.match(tool.description, /Your private traffic stays with your session/);
});

test("successful native retirement result terminates follow-up without changing its text response", async () => {
  const swarm = fixture();
  const now = T0 + 1000;
  setAgentStatus(db, swarm.id, "Maria", "idle", now);
  const handlers = createAgentToolHandlers({
    getDb: () => db,
    swarmId: swarm.id,
    run: 1,
    agentName: "Maria",
    clock: { now: () => now, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
  });
  const tool = createRetirementTool(handlers.retire);
  const result = await tool.execute("retire-call", { handoff: "Ready for a fresh worker." });
  assert.equal(result.terminate, true);
  assert.ok(JSON.stringify(result.content).includes("Replacement request"));
  assert.equal(listPendingConfigurationRequests(db, swarm.id, 1).length, 1);
});

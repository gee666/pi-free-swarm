import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerAgentMode } from "../src/agent-mode.js";
import { createAgentToolHandlers } from "../src/tools/agent-tools.js";
import { setAgentStatus } from "../src/broker/agent-state.js";
import {
  AGENT_NAME_ENV,
  AGENT_TOOL,
  DB_ENV,
  IDLE_ONLY_TOOLS,
  RUN_ENV,
  RUNNER_PID_ENV,
  SWARM_ID_ENV,
  WATCHER_NAME,
} from "../src/constants.js";
import { FakeExtensionApi } from "./helpers/fake-extension-api.js";
import { createTempDb, seedSwarm, T0 } from "./helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
class ObservedApi extends FakeExtensionApi {
  loadoutChanges = 0;
  private runtimeReady = false;
  seedLoadout(names: string[]): void {
    super.setActiveTools(names);
  }
  override getActiveTools(): string[] {
    assert.ok(this.runtimeReady, "getActiveTools requires initialized native runtime");
    return super.getActiveTools();
  }
  override setActiveTools(names: string[]): void {
    assert.ok(this.runtimeReady, "setActiveTools requires initialized native runtime");
    this.loadoutChanges++;
    super.setActiveTools(names);
  }
  override async startSession(cwd = process.cwd()): Promise<void> {
    this.runtimeReady = true;
    await super.startSession(cwd);
  }
  override async shutdownSession(): Promise<void> {
    await super.shutdownSession();
    this.runtimeReady = false;
  }
}
function setup(swarmId: number, name: string): ObservedApi {
  const pi = new ObservedApi();
  pi.seedLoadout(["read", "unrelated_tool"]);
  registerAgentMode(pi, {
    [DB_ENV]: db.path,
    [SWARM_ID_ENV]: String(swarmId),
    [RUN_ENV]: "1",
    [AGENT_NAME_ENV]: name,
    [RUNNER_PID_ENV]: String(process.pid),
  });
  return pi;
}

test("idle-only tools are hidden before first settle and activated once without disturbing other tools", async () => {
  const swarm = seedSwarm(db);
  const pi = setup(swarm.id, "Maria");
  try {
    assert.ok(IDLE_ONLY_TOOLS.every((name) => pi.toolNames().includes(name)));
    assert.equal(pi.loadoutChanges, 0, "factory performs registration only");
    await pi.startSession(temp.cwd);
    assert.ok(IDLE_ONLY_TOOLS.every((name) => !pi.getActiveTools().includes(name)));
    assert.ok(pi.getActiveTools().includes(AGENT_TOOL.retire));
    const initialChanges = pi.loadoutChanges;
    await pi.startSession(temp.cwd);
    assert.equal(pi.loadoutChanges, initialChanges);
    pi.settleAgent();
    assert.ok(IDLE_ONLY_TOOLS.every((name) => pi.getActiveTools().includes(name)));
    assert.equal(pi.loadoutChanges, initialChanges + 1);
    for (let turn = 0; turn < 20; turn++) pi.settleAgent();
    assert.equal(pi.loadoutChanges, initialChanges + 1);
    assert.ok(pi.getActiveTools().includes("read"));
    assert.ok(pi.getActiveTools().includes("unrelated_tool"));
  } finally {
    await pi.shutdownSession();
  }
});

test("persisted genuine idle restores eligibility after recovery, not for a different fresh identity", async () => {
  const swarm = seedSwarm(db);
  setAgentStatus(db, swarm.id, "Maria", "idle", T0 + 1);
  const recovered = setup(swarm.id, "Maria");
  const fresh = setup(swarm.id, "John");
  try {
    await recovered.startSession(temp.cwd);
    await fresh.startSession(temp.cwd);
    assert.ok(IDLE_ONLY_TOOLS.every((name) => recovered.getActiveTools().includes(name)));
    assert.ok(IDLE_ONLY_TOOLS.every((name) => !fresh.getActiveTools().includes(name)));
  } finally {
    await recovered.shutdownSession();
    await fresh.shutdownSession();
  }
});

test("Watcher never gains idle-only tools even after native settle", async () => {
  const swarm = seedSwarm(db);
  const pi = setup(swarm.id, WATCHER_NAME);
  try {
    await pi.startSession(temp.cwd);
    pi.settleAgent();
    assert.ok(IDLE_ONLY_TOOLS.every((name) => !pi.toolNames().includes(name)));
    assert.ok(IDLE_ONLY_TOOLS.every((name) => !pi.getActiveTools().includes(name)));
  } finally {
    await pi.shutdownSession();
  }
});

test("forced snooze calls before first idle are broker-rejected without side effects", () => {
  const swarm = seedSwarm(db);
  const tools = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria" });
  assert.throws(() => tools.snooze(), /after.*first.*idle/i);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM configuration_requests WHERE swarm_id = ?").get(swarm.id)?.n,
    0,
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM reminder_snoozes WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

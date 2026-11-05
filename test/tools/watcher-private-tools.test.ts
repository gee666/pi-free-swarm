import assert from "node:assert/strict";
import { test } from "node:test";
import { registerAgentMode } from "../../src/agent-mode.js";
import {
  AGENT_NAME_ENV,
  DB_ENV,
  RUN_ENV,
  RUNNER_PID_ENV,
  SWARM_ID_ENV,
  WATCHER_CHAT_ENV,
  WATCHER_NAME,
  WATCHER_READONLY_TOOLS,
} from "../../src/constants.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { createWatcherToolHandlers } from "../../src/tools/watcher-tools.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

test("private agent mode only registers readonly tools and retains them after settle", async (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  const pi = new FakeExtensionApi();
  registerAgentMode(pi, {
    [DB_ENV]: temp.db.path,
    [SWARM_ID_ENV]: String(swarm.id),
    [RUN_ENV]: "1",
    [AGENT_NAME_ENV]: WATCHER_NAME,
    [RUNNER_PID_ENV]: String(process.pid),
    [WATCHER_CHAT_ENV]: "1",
  });
  assert.deepEqual(pi.toolNames(), WATCHER_READONLY_TOOLS);
  await pi.startSession(temp.cwd);
  pi.settleAgent();
  assert.deepEqual(pi.getActiveTools(), WATCHER_READONLY_TOOLS);
  await pi.shutdownSession();
});

test("readonly Watcher tools inspect a stopped swarm without mutating records or syncing skills", async (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  temp.db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(swarm.id);
  const identity = { getDb: () => temp.db, swarmId: swarm.id, run: 1, agentName: WATCHER_NAME, readOnly: true };
  const events = temp.db.sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n;
  const tools = createAgentToolHandlers(identity);
  assert.match(tools.project(), /Brief:/);
  assert.match(await createWatcherToolHandlers(identity).overview(), /stopped/);
  assert.match(await tools.tasksSearch({}), /Next cursor:/);
  assert.match(await tools.criteriaSearch({}), /Next cursor:/);
  assert.match(await tools.postsSearch({}), /Next cursor:/);
  await tools.skillsSearch({});
  assert.equal(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, events);
});

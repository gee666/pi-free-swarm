import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Value } from "typebox/value";
import { AGENT_TOOL, WATCHER_NAME } from "../../src/constants.js";
import { reminderSnoozedUntil, REMINDER_SNOOZE_MS } from "../../src/broker/reminder-snooze.js";
import { sendMessage } from "../../src/broker/messages.js";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { listOpenAgentRecipients } from "../../src/store/message-queries.js";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

test("worker snooze tool has a fixed no-argument schema and explains unaffected messages", () => {
  const swarm = seedSwarm(db);
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria" }, 200);
  const tool = pi.tool(AGENT_TOOL.snooze);
  assert.ok(Value.Check(tool.parameters, {}));
  assert.equal(Value.Check(tool.parameters, { minutes: 1 }), false);
  assert.match(tool.description, /exactly 5 minutes/);
  assert.match(tool.description, /Direct messages and subscribed comments still arrive/);
  assert.match(tool.description, /budgets or quorum/);
  assert.ok(tool.promptSnippet);
});

test("Watcher never receives worker reminder snooze", () => {
  const swarm = seedSwarm(db);
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, run: 1, agentName: WATCHER_NAME }, 200);
  assert.equal(pi.toolNames().includes(AGENT_TOOL.snooze), false);
  assert.equal(pi.toolNames().includes(AGENT_TOOL.acceptance), false);
});

test("snooze handler reports exactly five minutes for its own agent without consuming messages", () => {
  const swarm = seedSwarm(db);
  let now = T0 + 1000;
  const clock = { now: () => now, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };
  const tools = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria", clock });
  const message = sendMessage(db, swarm.id, "John", ["Maria"], "real pending work", now);
  const pending = listOpenAgentRecipients(db, swarm.id);
  setAgentStatus(db, swarm.id, "Maria", "idle", now);
  const text = tools.snooze();
  assert.match(text, /Idle reminders snoozed for 5 minutes/);
  assert.ok(text.includes(new Date(now + REMINDER_SNOOZE_MS).toISOString()));
  assert.match(text, /Direct messages and subscribed comments still arrive/);
  assert.equal(reminderSnoozedUntil(db, swarm.id, "Maria"), now + REMINDER_SNOOZE_MS);
  assert.equal(reminderSnoozedUntil(db, swarm.id, "John"), 0);
  assert.deepEqual(listOpenAgentRecipients(db, swarm.id), pending);
  assert.ok(pending.some((recipient) => recipient.messageId === message.id));
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ?").get(swarm.id)?.n, 0);
  now += 1000;
  tools.snooze();
  assert.equal(reminderSnoozedUntil(db, swarm.id, "Maria"), now + REMINDER_SNOOZE_MS);
});

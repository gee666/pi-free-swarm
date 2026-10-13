import assert from "node:assert/strict";
import { after, it } from "node:test";
import { recordUsage, setAgentStatus } from "../../src/broker/agent-state.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { sendMainFeedback, sendMessage } from "../../src/broker/messages.js";
import { prepareRunCompletion } from "../../src/broker/run-acceptance.js";
import { readRunProgress } from "../../src/broker/run-progress.js";
import { beginResume, createSwarm, endRun } from "../../src/broker/swarms.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { getMessages } from "../../src/store/message-queries.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getSwarm, listAgentSessions } from "../../src/store/swarm-queries.js";
import { createTempDb } from "../helpers/temp-db.js";
import { FakeClock } from "../agents/fake-clock.js";

const temp = createTempDb();
const { db } = temp;
after(() => temp.cleanup());
const clock = new FakeClock(Date.now());
const create = () =>
  createSwarm(db, {
    name: "watched",
    taskPrompt: "Work.",
    agentNames: ["Maria"],
    runnerPid: process.pid,
    now: clock.now(),
  });

it("reserves Watcher for the human assistant", () => {
  assert.throws(
    () =>
      createSwarm(db, {
        name: "invalid",
        taskPrompt: "Work.",
        agentNames: ["watcher"],
        runnerPid: process.pid,
        now: clock.now(),
      }),
    /reserved participant names/,
  );
});

it("excludes Watcher from worker amount, working count and progress but includes usage in stats", () => {
  const swarm = create();
  setAgentStatus(db, swarm.id, WATCHER_NAME, "working", clock.now());
  recordUsage(
    db,
    swarm.id,
    WATCHER_NAME,
    {
      kind: "message",
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.5,
      model: "test",
    },
    clock.now(),
  );
  assert.equal(getSwarm(db, swarm.id, clock.now())?.agentAmount, 1);
  assert.equal(getSwarm(db, swarm.id, clock.now())?.agentsWorking, 0);
  const progress = readRunProgress(db, swarm.id, clock.now(), null);
  assert.equal(progress.agents.working, 0);
  assert.equal(progress.agents.pending, 1);
  assert.equal(progress.cost, 0.5);
  const stats = getStats(db, swarm.id, clock.now());
  assert.equal(stats?.agents.find((agent) => agent.name === WATCHER_NAME)?.turns, 1);
  assert.equal(stats?.totals.cost, 0.5);
  const feedback = sendMainFeedback(db, swarm.id, "Continue.", clock.now());
  assert.deepEqual(
    feedback.recipients.map((recipient) => recipient.name),
    ["Maria"],
  );
});

it("does not schedule an idle reminder for Watcher even when it is in the delivery map", () => {
  const swarm = create();
  const reminders = new IdleReminders({
    db,
    swarmId: swarm.id,
    clock,
    settings: { idleReminderDelay: 1, idleReminderMax: 1, idleReminderDigestSize: 1 },
    agents: new Map([
      [
        WATCHER_NAME,
        {
          status: "idle",
          deliver: async () => {
            assert.fail("Watcher was reminded");
          },
        },
      ],
    ]),
    onError: (error) => {
      throw error;
    },
  });
  assert.equal(reminders.update(), false);
  clock.advance(10);
  reminders.stop();
});

it("finishes despite busy Watcher and unread questions, retaining the queue across resume", () => {
  const swarm = create();
  setAgentStatus(db, swarm.id, "Maria", "crashed", clock.now());
  setAgentStatus(db, swarm.id, WATCHER_NAME, "working", clock.now());
  const question = sendMessage(db, swarm.id, "User", [WATCHER_NAME], "What happened?", clock.now());
  const decision = prepareRunCompletion(db, {
    swarmId: swarm.id,
    run: 1,
    runnerPid: process.pid,
    now: clock.now(),
    available: [],
    exhausted: new Set(["Maria"]),
  });
  assert.equal(decision.kind, "closed");
  endRun(db, swarm.id, process.pid, "finished", clock.now());
  assert.equal(getMessages(db, [question.id])[0].recipients[0].status, "pending");
  const queued = sendMessage(db, swarm.id, "User", [WATCHER_NAME], "Explain the result.", clock.now());
  assert.equal(queued.recipients[0].status, "pending");
  beginResume(db, swarm.id, process.pid, clock.now());
  assert.equal(listAgentSessions(db, swarm.id).filter((agent) => agent.name === WATCHER_NAME).length, 1);
});

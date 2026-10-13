import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type { ParticipantStatus } from "../../src/api-types.js";
import type { DeliveryOutcome, PromptPayload } from "../../src/agents/supervisor.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { sendMessage } from "../../src/broker/messages.js";
import { markRead } from "../../src/broker/delivery-state.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { IDLE_REMINDER_HEADER } from "../../src/constants.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

let temp: TempDb | undefined;
afterEach(() => temp?.cleanup());

function setup(max = 2) {
  temp = createTempDb();
  const { db } = temp;
  const clock = new FakeClock(T0 + 1);
  const swarm = seedSwarm(db, { agents: ["Maria", "John"] });
  const prompts: PromptPayload[] = [];
  const agent: { status: ParticipantStatus; deliver(prompt: PromptPayload): Promise<DeliveryOutcome> } = {
    status: "idle",
    async deliver(prompt: PromptPayload) {
      prompts.push(prompt);
      agent.status = "working";
      reminders.statusChanged("Maria", "working");
      return { accepted: true };
    },
  };
  const reminders = new IdleReminders({
    db,
    swarmId: swarm.id,
    clock,
    agents: new Map([["Maria", agent]]),
    settings: { idleReminderDelay: 100, idleReminderMax: max, idleReminderDigestSize: 2 },
    onError: (error) => assert.fail(String(error)),
  });
  const settle = () => {
    agent.status = "idle";
    reminders.statusChanged("Maria", "idle");
    return reminders.update();
  };
  const fire = async () => {
    clock.advance(100);
    await Promise.resolve();
  };
  return { db, clock, swarm, agent, reminders, prompts, settle, fire };
}

it("schedules after idle delay and delivers a bounded latest-wall digest without messages or read marks", async () => {
  const { db, swarm, reminders, clock, prompts } = setup();
  for (const title of ["old", "middle", "latest"]) {
    createPost(db, swarm.id, "John", { title, text: "x".repeat(1000) }, clock.now());
  }
  assert.equal(reminders.update(), true);
  assert.equal(clock.pending, 1);
  reminders.update();
  assert.equal(clock.pending, 1, "polling does not restart or duplicate the timer");
  clock.advance(99);
  assert.equal(prompts.length, 0);
  clock.advance(1);
  await Promise.resolve();
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].messageIds, []);
  assert.ok(prompts[0].text.startsWith(IDLE_REMINDER_HEADER + "\n\n"));
  assert.match(prompts[0].text, /John · 0s ago · latest/);
  assert.match(prompts[0].text, /middle/);
  assert.doesNotMatch(prompts[0].text, /· old|\(new\)|swarm message/);
  assert.ok(prompts[0].text.length < 1000);
  for (const table of ["messages", "threads", "read_marks"]) {
    assert.equal(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  }
});

it("busy transitions cancel immediately and a fresh idle period gets the full delay", async () => {
  const { agent, reminders, clock, prompts, settle } = setup();
  reminders.update();
  clock.advance(99);
  agent.status = "working";
  reminders.statusChanged("Maria", "working");
  assert.equal(clock.pending, 0);
  clock.advance(500);
  assert.equal(prompts.length, 0);
  settle();
  clock.advance(99);
  assert.equal(prompts.length, 0);
  clock.advance(1);
  await Promise.resolve();
  assert.equal(prompts.length, 1);
});

it("pending deliveries cancel timers and are checked again at timer expiry", async () => {
  const { db, swarm, reminders, clock, prompts } = setup();
  reminders.update();
  const message = sendMessage(db, swarm.id, "User", ["Maria"], "Do this.", clock.now());
  assert.equal(reminders.update(), false);
  assert.equal(clock.pending, 0);
  markRead(db, swarm.id, "Maria", [message.id], clock.now());
  reminders.update();
  sendMessage(db, swarm.id, "John", ["Maria"], "Another thing.", clock.now());
  clock.advance(100);
  await Promise.resolve();
  assert.equal(prompts.length, 0, "a message arriving between polls wins");
});

it("bounds consecutive reminders; ordinary turns do not reset the budget", async () => {
  const { reminders, agent, prompts, settle, fire } = setup();
  reminders.update();
  await fire();
  assert.equal(settle(), true);
  await fire();
  assert.equal(prompts.length, 2);
  assert.equal(settle(), false);
  agent.status = "working";
  reminders.statusChanged("Maria", "working");
  assert.equal(settle(), false);
  await fire();
  assert.equal(prompts.length, 2);
});

it("real messages, own posts and own comments reset the budget, but others' wall activity does not", async () => {
  const { db, swarm, reminders, clock, prompts, settle, fire } = setup(1);
  reminders.update();
  await fire();
  assert.equal(settle(), false);
  const post = createPost(db, swarm.id, "John", { title: "Work", text: "done" }, clock.now());
  assert.equal(reminders.update(), false);
  createPost(db, swarm.id, "Maria", { title: "Progress", text: "done" }, clock.now());
  assert.equal(reminders.update(), true);
  await fire();
  assert.equal(settle(), false);
  addComment(db, swarm.id, "Maria", post.id, "Verified.", clock.now());
  assert.equal(reminders.update(), true);
  await fire();
  assert.equal(settle(), false);
  reminders.realMessage("Maria");
  assert.equal(settle(), true);
  assert.equal(clock.pending, 1);
  reminders.realMessage("Maria");
  assert.equal(clock.pending, 0, "real delivery cancels an outstanding timer");
  settle();
  await fire();
  assert.equal(prompts.length, 4);
});

for (const verdict of ["accepted", "blocked"] as const) {
  it(`skips ${verdict} at expiry and cancels scheduled reminders when polled`, async () => {
    const { db, swarm, reminders, clock, prompts } = setup();
    reminders.update();
    mutateAcceptance(db, swarm.id, "Maria", { action: "claim", revision: 0 }, clock.now());
    mutateAcceptance(
      db,
      swarm.id,
      "Maria",
      {
        action: "update",
        revision: 1,
        verdict,
        payload: {
          evidence: [{ reference: "checks", result: verdict }],
          knownGaps: verdict === "blocked" ? ["Need input"] : [],
          findings: verdict === "blocked" ? ["Supply input"] : [],
        },
      },
      clock.now(),
    );
    clock.advance(100);
    await Promise.resolve();
    assert.equal(prompts.length, 0);
    assert.equal(reminders.update(), false);
    assert.equal(clock.pending, 0);
  });
}

it("an in-flight prompt keeps completion pending even after the budget is spent", async () => {
  const { reminders, clock, agent } = setup(1);
  let finish: ((outcome: DeliveryOutcome) => void) | undefined;
  agent.deliver = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  reminders.update();
  clock.advance(100);
  assert.equal(clock.pending, 0);
  assert.equal(reminders.update(), true);
  assert.ok(finish);
  finish({ accepted: true });
  await Promise.resolve();
  assert.equal(reminders.update(), false);
});

it("accepted polling and run shutdown cancel outstanding timers", () => {
  const { db, swarm, reminders, clock } = setup();
  reminders.update();
  mutateAcceptance(db, swarm.id, "Maria", { action: "claim", revision: 0 }, clock.now());
  mutateAcceptance(
    db,
    swarm.id,
    "Maria",
    {
      action: "update",
      revision: 1,
      verdict: "accepted",
      payload: { evidence: [{ reference: "checks", result: "passed" }], knownGaps: [], findings: [] },
    },
    clock.now(),
  );
  assert.equal(reminders.update(), false);
  assert.equal(clock.pending, 0);
  mutateAcceptance(db, swarm.id, "John", { action: "challenge", revision: 2, finding: "Output missing" }, clock.now());
  assert.equal(reminders.update(), true);
  reminders.stop();
  assert.equal(clock.pending, 0);
  clock.advance(100);
  assert.equal(reminders.update(), false);
});

it("budgets are independent for each agent", async () => {
  const { db, swarm, clock } = setup();
  const counts = new Map<string, number>();
  const agents = new Map(
    ["Maria", "John"].map((name) => [
      name,
      {
        status: "idle" as const,
        async deliver() {
          counts.set(name, (counts.get(name) ?? 0) + 1);
          return { accepted: true } as const;
        },
      },
    ]),
  );
  const reminders = new IdleReminders({
    db,
    swarmId: swarm.id,
    clock,
    agents,
    settings: { idleReminderDelay: 100, idleReminderMax: 1, idleReminderDigestSize: 1 },
    onError: (error) => assert.fail(String(error)),
  });
  reminders.update();
  clock.advance(100);
  await Promise.resolve();
  assert.deepEqual([...counts.values()], [1, 1]);
  assert.equal(reminders.update(), false);
  reminders.realMessage("Maria");
  reminders.update();
  clock.advance(100);
  await Promise.resolve();
  assert.equal(counts.get("Maria"), 2);
  assert.equal(counts.get("John"), 1);
});

it("unavailable agents cancel reminders", () => {
  const { reminders, agent, clock } = setup();
  reminders.update();
  agent.status = "crashed";
  reminders.statusChanged("Maria", "crashed");
  assert.equal(clock.pending, 0);
  assert.equal(reminders.update(), false);
});

it("disabled budgets, unavailable agents and stopped runs schedule nothing", () => {
  const { reminders, clock, agent } = setup(0);
  assert.equal(reminders.update(), false);
  assert.equal(clock.pending, 0);
  agent.status = "crashed";
  assert.equal(reminders.update(), false);
  reminders.stop();
  agent.status = "idle";
  assert.equal(reminders.update(), false);
});

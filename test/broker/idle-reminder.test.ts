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
import { markPostsCovered } from "../../src/store/wall-coverage.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

let temp: TempDb | undefined;
afterEach(() => temp?.cleanup());

function setup(delay = 100) {
  temp = createTempDb();
  const { db } = temp;
  const clock = new FakeClock(T0 + 1);
  const swarm = seedSwarm(db, { agents: ["Maria", "John"] });
  const prompts: PromptPayload[] = [];
  const agent: { status: ParticipantStatus; deliver(prompt: PromptPayload): Promise<DeliveryOutcome> } = {
    status: "idle",
    async deliver(prompt: PromptPayload) {
      prompts.push(prompt);
      // This fake models context observation before the queue acknowledgment.
      markPostsCovered(db, swarm.id, "Maria", prompt.postIds ?? []);
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
    settings: { idleReminderDelay: delay, idleReminderDigestSize: 2 },
    onError: (error) => assert.fail(String(error)),
  });
  const settle = () => {
    agent.status = "idle";
    reminders.statusChanged("Maria", "idle");
    return reminders.update();
  };
  const fire = async () => {
    clock.advance(delay);
    await Promise.resolve();
  };
  const vote = (name: string, verdict: "accepted" | "incomplete" | "blocked") =>
    mutateAcceptance(db, swarm.id, name, { action: "vote", verdict, reason: "Checked the task." }, clock.now());
  return { db, clock, swarm, agent, reminders, prompts, settle, fire, vote };
}

it("delivers bounded oldest-uncovered full posts and productive alternative-work instructions", async () => {
  const { db, swarm, reminders, clock, prompts } = setup();
  for (const title of ["old", "middle", "latest"]) {
    createPost(db, swarm.id, "John", { title, text: "Complete fresh body." }, clock.now());
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
  assert.match(prompts[0].text, /leave that dependency pending and take another useful piece of work/);
  assert.match(prompts[0].text, /Do not invent extra work solely because quorum has not formed/);
  assert.match(prompts[0].text, /evidence, a correction, or a decision to advance/);
  assert.match(prompts[0].text, /whole-task vote with swarm_acceptance/);
  assert.match(prompts[0].text, /Votes: 0 accepted, 0 incomplete, 0 blocked\. Quorum: 2\/2/);
  assert.match(prompts[0].text, /\[swarm post #\d+\] John: old\nComplete fresh body\./);
  assert.match(prompts[0].text, /middle/);
  assert.doesNotMatch(prompts[0].text, /John: latest|\(new\)|swarm message|challenge/);
  assert.ok(prompts[0].text.length < 1400);
  for (const table of ["messages", "threads", "read_marks"]) {
    assert.equal(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  }
});

it("unchanged reminders repeat no covered post bodies; later fresh posts still arrive", async () => {
  const { db, swarm, clock, prompts, settle, fire } = setup();
  const old = createPost(db, swarm.id, "John", { title: "Already fetched", text: "Tool-covered body" }, clock.now());
  markPostsCovered(db, swarm.id, "Maria", [old.id]);
  const fresh = createPost(db, swarm.id, "John", { title: "Fresh", text: "Fresh full body" }, clock.now());
  addComment(db, swarm.id, "John", fresh.id, "Comment notification body", clock.now());
  settle();
  await fire();
  assert.match(prompts[0].text, /Fresh full body/);
  assert.doesNotMatch(prompts[0].text, /Tool-covered body|Comment notification body/);
  settle();
  await fire();
  assert.doesNotMatch(prompts[1].text, /Fresh full body|Tool-covered body|Comment notification body/);
  createPost(db, swarm.id, "John", { title: "Later", text: "Later full body" }, clock.now());
  settle();
  await fire();
  assert.match(prompts[2].text, /Later full body/);
});

it("queue acceptance and rejection alone never cover fresh reminder posts", async () => {
  const { db, swarm, clock, prompts, agent, settle, fire } = setup();
  createPost(db, swarm.id, "John", { title: "Unobserved", text: "Must remain retrievable" }, clock.now());
  let accepted = false;
  agent.deliver = async (payload) => {
    prompts.push(payload);
    return accepted ? { accepted: true } : { accepted: false, error: "Not delivered" };
  };
  for (const value of [false, true, true]) {
    accepted = value;
    settle();
    await fire();
  }
  assert.equal(prompts.length, 3);
  for (const payload of prompts) assert.match(payload.text, /Must remain retrievable/);
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

it("keeps reminding through repeated idle turns without a cap or wall activity", async () => {
  const { reminders, prompts, settle, fire } = setup();
  for (let turn = 0; turn < 12; turn++) {
    assert.equal(settle(), true);
    await fire();
    assert.equal(prompts.length, turn + 1);
  }
  assert.equal(settle(), true);
  reminders.stop();
});

it("supports zero delay without scheduling a timer loop", async () => {
  const { reminders, clock, prompts, settle, fire } = setup(0);
  for (let turn = 0; turn < 3; turn++) {
    assert.equal(settle(), true);
    await fire();
    assert.equal(prompts.length, turn + 1);
    assert.equal(clock.pending, 0);
  }
  reminders.stop();
});

it("wall posts and comments do not restart an idle delay", async () => {
  const { db, swarm, reminders, clock, prompts } = setup();
  reminders.update();
  clock.advance(50);
  const post = createPost(db, swarm.id, "John", { title: "Work", text: "done" }, clock.now());
  createPost(db, swarm.id, "Maria", { title: "Progress", text: "done" }, clock.now());
  addComment(db, swarm.id, "Maria", post.id, "Verified.", clock.now());
  assert.equal(reminders.update(), true);
  assert.equal(clock.nextDelay(), 50);
  clock.advance(50);
  await Promise.resolve();
  assert.equal(prompts.length, 1);
});

it("real delivery cancels an outstanding timer and the next idle period gets a full delay", async () => {
  const { reminders, clock, prompts, settle } = setup();
  reminders.update();
  clock.advance(50);
  reminders.realMessage("Maria");
  assert.equal(clock.pending, 0);
  assert.equal(settle(), true);
  assert.equal(clock.nextDelay(), 100);
  clock.advance(99);
  assert.equal(prompts.length, 0);
  clock.advance(1);
  await Promise.resolve();
  assert.equal(prompts.length, 1);
});

for (const verdict of ["accepted", "blocked"] as const) {
  it(`requires ${verdict} quorum at expiry and cancels timers when polled`, async () => {
    const { reminders, clock, prompts, settle, fire, vote } = setup();
    reminders.update();
    vote("Maria", verdict);
    await fire();
    assert.equal(prompts.length, 1, "a single vote is not a quorum");
    assert.match(prompts[0].text, new RegExp(verdict === "accepted" ? "1 accepted" : "1 blocked"));
    settle();
    vote("John", verdict);
    await fire();
    assert.equal(prompts.length, 1, "quorum arriving between polls wins");
    assert.equal(reminders.update(), false);
    assert.equal(clock.pending, 0);
    vote("John", "incomplete");
    assert.equal(reminders.update(), true);
    vote("John", verdict);
    assert.equal(reminders.update(), false);
    assert.equal(clock.pending, 0);
  });
}

for (const second of ["incomplete", "blocked"] as const) {
  it(`continues waking with accepted and ${second} votes`, async () => {
    const { reminders, prompts, settle, fire, vote } = setup();
    vote("Maria", "accepted");
    vote("John", second);
    for (let turn = 0; turn < 7; turn++) {
      assert.equal(settle(), true);
      await fire();
    }
    assert.equal(prompts.length, 7);
    reminders.stop();
  });
}

it("keeps in-flight delivery pending without scheduling duplicate prompts", async () => {
  const { reminders, clock, agent, vote } = setup();
  let finish: ((outcome: DeliveryOutcome) => void) | undefined;
  let deliveries = 0;
  agent.deliver = () => {
    deliveries++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  reminders.update();
  clock.advance(100);
  assert.equal(clock.pending, 0);
  assert.equal(reminders.update(), true);
  clock.advance(1000);
  assert.equal(deliveries, 1);
  assert.equal(clock.pending, 0);
  vote("Maria", "accepted");
  vote("John", "accepted");
  assert.equal(reminders.update(), true, "quorum does not hide outstanding delivery");
  assert.ok(finish);
  finish({ accepted: true });
  await Promise.resolve();
  assert.equal(reminders.update(), false);
});

it("schedules reminders independently for each idle agent", async () => {
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
    settings: { idleReminderDelay: 100, idleReminderDigestSize: 1 },
    onError: (error) => assert.fail(String(error)),
  });
  for (let turn = 1; turn <= 3; turn++) {
    reminders.update();
    reminders.realMessage("Maria");
    clock.advance(100);
    await Promise.resolve();
    assert.equal(counts.get("John"), turn);
    assert.equal(counts.has("Maria"), false);
  }
  reminders.update();
  clock.advance(100);
  await Promise.resolve();
  assert.equal(counts.get("Maria"), 1);
  assert.equal(counts.get("John"), 4);
  reminders.stop();
});

it("unavailable agents and stopped runs cancel reminders", async () => {
  const { reminders, agent, clock, prompts, settle } = setup();
  reminders.update();
  agent.status = "crashed";
  reminders.statusChanged("Maria", "crashed");
  assert.equal(clock.pending, 0);
  assert.equal(reminders.update(), false);
  settle();
  agent.status = "stopped";
  clock.advance(100);
  await Promise.resolve();
  assert.equal(prompts.length, 0, "availability is rechecked at expiry");
  settle();
  reminders.stop();
  assert.equal(clock.pending, 0);
  clock.advance(100);
  assert.equal(reminders.update(), false);
  assert.equal(prompts.length, 0);
});

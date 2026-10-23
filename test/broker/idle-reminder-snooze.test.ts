import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type { ParticipantStatus } from "../../src/api-types.js";
import type { DeliveryOutcome, PromptPayload } from "../../src/agents/supervisor.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { REMINDER_SNOOZE_MS, snoozeReminders } from "../../src/broker/reminder-snooze.js";
import { createPost } from "../../src/broker/wall.js";
import { listFreshPosts } from "../../src/store/wall-coverage.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

let temp: TempDb | undefined;
let active: IdleReminders[] = [];
afterEach(() => {
  for (const reminders of active) reminders.stop();
  active = [];
  temp?.cleanup();
});

function setup(delay = 100) {
  temp = createTempDb();
  const { db } = temp;
  const swarm = seedSwarm(db, { agents: ["Maria", "John"] });
  const clock = new FakeClock(T0 + 1);
  setAgentStatus(db, swarm.id, "Maria", "idle", clock.now());
  const prompts: { name: string; text: string }[] = [];
  const agents = new Map(
    ["Maria", "John"].map((name) => [
      name,
      {
        status: "idle" as ParticipantStatus,
        async deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
          prompts.push({ name, text: prompt.text });
          return { accepted: true } as const;
        },
      },
    ]),
  );
  const create = () => {
    const reminders = new IdleReminders({
      db,
      swarmId: swarm.id,
      clock,
      agents,
      settings: { idleReminderDelay: delay, idleReminderDigestSize: 2 },
      onError: (error) => assert.fail(String(error)),
    });
    active.push(reminders);
    return reminders;
  };
  const fire = async (ms: number) => {
    clock.advance(ms);
    await Promise.resolve();
  };
  const count = (name = "Maria") => prompts.filter((prompt) => prompt.name === name).length;
  const snooze = () => snoozeReminders(db, swarm.id, "Maria", clock.now());
  return { db, swarm, clock, prompts, agents, create, fire, count, snooze };
}

it("replaces an existing timer with a five-minute wake and retains fresh unseen post content", async () => {
  const { db, swarm, clock, prompts, create, fire, count, snooze } = setup();
  const reminders = create();
  reminders.update();
  clock.advance(20);
  const until = snooze();
  assert.equal(until, clock.now() + REMINDER_SNOOZE_MS);
  createPost(db, swarm.id, "John", { title: "Useful gap", text: "Evidence remains available" }, clock.now());
  reminders.update();
  await fire(REMINDER_SNOOZE_MS - 1);
  assert.equal(count(), 0);
  assert.equal(count("John"), 1, "another worker is not snoozed");
  assert.equal(listFreshPosts(db, swarm.id, "Maria", 10).total, 1);
  await fire(1);
  assert.equal(count(), 1);
  assert.match(prompts.find((prompt) => prompt.name === "Maria")?.text ?? "", /Evidence remains available/);
});

it("checks durable snooze at timer expiry even before the next reconciliation poll", async () => {
  const { clock, create, fire, count, snooze } = setup();
  const reminders = create();
  reminders.update();
  snooze();
  await fire(100);
  assert.equal(count(), 0);
  reminders.update();
  await fire(REMINDER_SNOOZE_MS - 101);
  assert.equal(count(), 0);
  await fire(1);
  assert.equal(count(), 1);
  assert.equal(clock.now(), T0 + 1 + REMINDER_SNOOZE_MS);
});

it("wakes at five minutes even when the configured ordinary reminder delay is longer", async () => {
  const { create, fire, count, snooze } = setup(REMINDER_SNOOZE_MS * 2);
  const reminders = create();
  reminders.update();
  snooze();
  reminders.update();
  await fire(REMINDER_SNOOZE_MS);
  assert.equal(count(), 1);
  assert.equal(count("John"), 0);
});

it("withdraws a selected reminder if snooze commits before the final send boundary", async () => {
  const { agents, prompts, clock, create, fire, count, snooze } = setup();
  const agent = agents.get("Maria");
  assert.ok(agent);
  let selected: PromptPayload | undefined;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  agent.deliver = async (payload) => {
    selected = payload;
    await gate;
    const ready = payload.beforeSend ? payload.beforeSend() : payload;
    if (ready) prompts.push({ name: "Maria", text: ready.text });
    return ready ? { accepted: true } : { accepted: false, error: "withdrawn", withdrawn: true };
  };
  const reminders = create();
  reminders.update();
  clock.advance(100);
  assert.ok(selected);
  snooze();
  assert.equal(selected.beforeSend?.(), null);
  assert.ok(release);
  release();
  await fire(0);
  assert.equal(count(), 0);
  reminders.update();
  await fire(REMINDER_SNOOZE_MS);
  assert.equal(count(), 1);
});

it("only an explicit new snooze extends the deadline, not ordinary polling", async () => {
  const { create, fire, count, snooze } = setup();
  const reminders = create();
  snooze();
  reminders.update();
  await fire(1_000);
  snooze();
  reminders.update();
  reminders.update();
  await fire(REMINDER_SNOOZE_MS - 1);
  assert.equal(count(), 0);
  await fire(1);
  assert.equal(count(), 1);
});

it("reconstructs the same deadline after reminder-loop recovery", async () => {
  const { create, fire, count, snooze } = setup();
  const first = create();
  snooze();
  first.update();
  await fire(1_000);
  first.stop();
  const replacement = create();
  replacement.update();
  await fire(REMINDER_SNOOZE_MS - 1_001);
  assert.equal(count(), 0);
  await fire(1);
  assert.equal(count(), 1);
});

for (const ending of ["accepted", "blocked", "stop"] as const) {
  it(`does not wake after ${ending} during a snooze`, async () => {
    const { db, swarm, clock, create, fire, count, snooze } = setup();
    const reminders = create();
    snooze();
    reminders.update();
    if (ending === "stop") reminders.stop();
    else {
      for (const name of ["Maria", "John"])
        mutateAcceptance(
          db,
          swarm.id,
          name,
          { action: "vote", verdict: ending, reason: "Final evidence" },
          clock.now(),
        );
      assert.equal(reminders.update(), false);
    }
    await fire(REMINDER_SNOOZE_MS);
    assert.equal(count(), 0);
    assert.equal(clock.pending, 0);
  });
}

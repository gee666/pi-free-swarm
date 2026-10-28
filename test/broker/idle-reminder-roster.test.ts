import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type { PromptPayload } from "../../src/agents/supervisor.js";
import type { DeliveryTarget } from "../../src/broker/delivery.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { createPost } from "../../src/broker/wall.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

let temp: TempDb | undefined;
let reminders: IdleReminders | undefined;
afterEach(() => {
  reminders?.stop();
  temp?.cleanup();
});

function setup() {
  temp = createTempDb();
  const { db } = temp;
  const swarm = seedSwarm(db, { agents: ["Maria", "John"] });
  const clock = new FakeClock(T0 + 1);
  const delivered: string[] = [];
  const target = (name: string): DeliveryTarget => ({
    status: "idle",
    async deliver(payload) {
      const ready = payload.beforeSend ? payload.beforeSend() : payload;
      if (!ready) return { accepted: false, error: "withdrawn", withdrawn: true };
      delivered.push(name);
      return { accepted: true };
    },
  });
  const agents = new Map([["Maria", target("Maria")]]);
  const loop = new IdleReminders({
    db,
    swarmId: swarm.id,
    clock,
    agents,
    settings: { idleReminderDelay: 100 },
    onError: (error) => assert.fail(String(error)),
  });
  reminders = loop;
  const fire = async () => {
    clock.advance(100);
    await Promise.resolve();
  };
  return { loop, clock, agents, target, delivered, fire, db, swarm };
}

it("discovers added workers and cancels deleted worker timers without restarting other schedules", async () => {
  const { loop, clock, agents, target, delivered, fire } = setup();
  loop.update();
  clock.advance(50);
  agents.set("John", target("John"));
  loop.update();
  assert.equal(clock.pending, 2);
  clock.advance(50);
  await Promise.resolve();
  assert.deepEqual(delivered, ["Maria"]);
  agents.delete("Maria");
  loop.update();
  clock.advance(50);
  await Promise.resolve();
  assert.deepEqual(delivered, ["Maria", "John"]);
  loop.update();
  await fire();
  assert.deepEqual(delivered, ["Maria", "John"]);
  await fire();
  assert.deepEqual(delivered, ["Maria", "John", "John"]);
});

it("withdraws a selected reminder when its worker leaves the active runtime map before send", async () => {
  const { loop, clock, agents, delivered, fire } = setup();
  let selected: PromptPayload | undefined;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  agents.set("Maria", {
    status: "idle",
    async deliver(payload) {
      selected = payload;
      await gate;
      const ready = payload.beforeSend ? payload.beforeSend() : payload;
      if (ready) delivered.push("Maria");
      return ready ? { accepted: true } : { accepted: false, error: "withdrawn", withdrawn: true };
    },
  });
  loop.update();
  clock.advance(100);
  assert.ok(selected);
  agents.delete("Maria");
  loop.update();
  assert.equal(selected.beforeSend?.(), null);
  assert.ok(release);
  release();
  await fire();
  assert.deepEqual(delivered, []);
  assert.equal(clock.pending, 0);
});

it("resets only the active worker's backoff", async () => {
  const { loop, clock, agents, target, delivered, db, swarm } = setup();
  agents.set("John", target("John"));
  loop.update();
  clock.advance(100);
  await Promise.resolve();
  assert.deepEqual(delivered, ["Maria", "John"]);
  loop.update();
  assert.equal(clock.nextDelay(), 200);
  createPost(db, swarm.id, "Maria", { title: "Progress", text: "Checked the tests." }, clock.now());
  loop.update();
  assert.equal(clock.nextDelay(), 100);
  clock.advance(100);
  await Promise.resolve();
  assert.deepEqual(delivered, ["Maria", "John", "Maria"]);
  clock.advance(100);
  await Promise.resolve();
  assert.deepEqual(delivered, ["Maria", "John", "Maria", "John"]);
});

it("never registers new timers after the reminder loop has stopped", () => {
  const { loop, clock, agents, target } = setup();
  loop.update();
  loop.stop();
  agents.set("John", target("John"));
  assert.equal(loop.update(), false);
  assert.equal(clock.pending, 0);
});

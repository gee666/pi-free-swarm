import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeliveryOutcome, PromptPayload } from "../../src/agents/supervisor.js";
import { markDelivered, markRead } from "../../src/broker/delivery-state.js";
import { createPost } from "../../src/broker/wall.js";
import { insertSystemNotice } from "../../src/broker/message-insert.js";
import { DEFAULT_IDLE_REMINDER_DELAY } from "../../src/constants.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { setAgentActivity } from "../../src/broker/agent-state.js";
import { snoozeReminders } from "../../src/broker/reminder-snooze.js";
import { workFixture } from "../helpers/work-graph.js";
import { FakeClock } from "../agents/fake-clock.js";
import { T0 } from "../helpers/temp-db.js";

function reminders(f: ReturnType<typeof workFixture>, delay = 100) {
  const clock = new FakeClock(T0 + 1);
  const prompts: PromptPayload[] = [];
  const agent = {
    status: "idle" as const,
    async deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
      const final = prompt.beforeSend ? prompt.beforeSend() : prompt;
      if (final) prompts.push(final);
      return { accepted: true };
    },
  };
  const idle = new IdleReminders({
    db: f.db,
    swarmId: f.swarmId,
    clock,
    agents: new Map([["Ann", agent]]),
    settings: { idleReminderDelay: delay },
    onError: (error) => assert.fail(String(error)),
  });
  return { clock, prompts, idle };
}

test("reminders contain unmet gates, own queue, votes, five runnable tasks and unlinked count", async (t) => {
  const f = workFixture(t);
  const owned = f.task(f.criterion.id, [], true);
  for (let i = 0; i < 8; i++) f.task();
  const messageIds = f.db.sql
    .prepare("SELECT id FROM messages")
    .all()
    .map((row) => Number(row.id));
  markRead(f.db, f.swarmId, "Ann", messageIds, f.input().now);
  const { clock, prompts, idle } = reminders(f);
  assert.equal(idle.update(), true);
  idle.update();
  assert.equal(clock.pending, 1);
  clock.advance(100);
  await Promise.resolve();
  const text = prompts[0]?.text ?? "";
  assert.match(text, /linked \(1\)|tasks \(/);
  assert.match(text, new RegExp(`#${owned.id} \\[claimed\\]`));
  assert.match(text, /Votes needed:|Unlinked criteria: 1/);
  const runnable = text.split("Runnable unclaimed:\n")[1]?.split("\nUnlinked")[0] ?? "";
  assert.equal(runnable.split("\n").length, 5);
  assert.doesNotMatch(text, /quorum|swarm_acceptance|\[swarm post/);
  idle.stop();
});

test("completion cancels reminders, including already scheduled ones", async (t) => {
  const f = workFixture(t);
  const { clock, prompts, idle } = reminders(f);
  idle.update();
  f.settle();
  assert.equal(idle.update(), false);
  clock.advance(100);
  await Promise.resolve();
  assert.equal(prompts.length, 0);
  assert.equal(idle.update(), false);
});

test("snooze postpones reminders without changing run gates", async (t) => {
  const f = workFixture(t);
  f.db.sql
    .prepare("UPDATE participants SET first_idle_at = ?, status = 'idle' WHERE swarm_id = ? AND name = 'Ann'")
    .run(T0, f.swarmId);
  const { clock, prompts, idle } = reminders(f);
  const until = snoozeReminders(f.db, f.swarmId, "Ann", clock.now());
  idle.update();
  clock.advance(100);
  await Promise.resolve();
  assert.equal(prompts.length, 0);
  clock.advance(until - clock.now());
  await Promise.resolve();
  assert.equal(prompts.length, 1);
  idle.stop();
});

test("consecutive idle reminders back off 1, 2, 4, 8, 16, then 30 minutes", async (t) => {
  const f = workFixture(t);
  const { clock, prompts, idle } = reminders(f, DEFAULT_IDLE_REMINDER_DELAY);
  t.after(() => idle.stop());
  for (const [index, minutes] of [1, 2, 4, 8, 16, 30, 30].entries()) {
    assert.equal(idle.update(), true);
    assert.equal(clock.nextDelay(), minutes * 60_000);
    clock.advance(minutes * 60_000 - 1);
    assert.equal(prompts.length, index);
    clock.advance(1);
    await Promise.resolve();
    assert.equal(prompts.length, index + 1);
    // Processing a reminder is not real work and must not reset the backoff.
    idle.statusChanged("Ann", "working");
    idle.statusChanged("Ann", "idle");
  }
});

for (const action of ["task", "post", "tool", "message", "notice"])
  test(`${action} activity resets the reminder delay, including a previously scheduled timer`, async (t) => {
    const f = workFixture(t);
    const { clock, prompts, idle } = reminders(f);
    t.after(() => idle.stop());
    for (let i = 0; i < 3; i++) {
      idle.update();
      clock.advance(clock.nextDelay() ?? 0);
      await Promise.resolve();
    }
    idle.update();
    assert.equal(clock.nextDelay(), 800);
    clock.advance(50);
    if (action === "task") f.task();
    else if (action === "post")
      createPost(f.db, f.swarmId, "Ann", { title: "Progress", text: "Test evidence recorded." }, clock.now());
    else if (action === "tool")
      setAgentActivity(f.db, f.swarmId, "Ann", { kind: "tool", toolName: "swarm_tasks_get" }, clock.now());
    else {
      const message = f.db.write(() =>
        insertSystemNotice(f.db, {
          swarmId: f.swarmId,
          recipient: "Ann",
          text: "Please check this.",
          now: clock.now(),
        }),
      );
      if (action === "message") idle.realMessage("Ann");
      // Delivery/read acknowledgements also reset without an in-process callback.
      markDelivered(f.db, f.swarmId, "Ann", [message.id], clock.now());
      markRead(f.db, f.swarmId, "Ann", [message.id], clock.now());
    }
    idle.update();
    assert.equal(clock.nextDelay(), 100);
    clock.advance(99);
    assert.equal(prompts.length, 3);
    clock.advance(1);
    await Promise.resolve();
    assert.equal(prompts.length, 4);
    idle.update();
    assert.equal(clock.nextDelay(), 200);
  });

test("activity between polling and timer expiry withdraws the stale reminder", async (t) => {
  const f = workFixture(t);
  const { clock, prompts, idle } = reminders(f);
  t.after(() => idle.stop());
  idle.update();
  f.task();
  clock.advance(100);
  await Promise.resolve();
  assert.equal(prompts.length, 0);
  idle.update();
  assert.equal(clock.nextDelay(), 100);
});

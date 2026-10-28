import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeliveryOutcome, PromptPayload } from "../../src/agents/supervisor.js";
import { markRead } from "../../src/broker/delivery-state.js";
import { IdleReminders } from "../../src/broker/idle-reminder.js";
import { snoozeReminders } from "../../src/broker/reminder-snooze.js";
import { workFixture } from "../helpers/work-graph.js";
import { FakeClock } from "../agents/fake-clock.js";
import { T0 } from "../helpers/temp-db.js";

function reminders(f: ReturnType<typeof workFixture>) {
  const clock = new FakeClock(T0 + 1);
  const prompts: PromptPayload[] = [];
  const agent = {
    status: "idle" as const,
    async deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
      const final = prompt.beforeSend?.() ?? prompt;
      if (final) prompts.push(final);
      return { accepted: true };
    },
  };
  const idle = new IdleReminders({
    db: f.db,
    swarmId: f.swarmId,
    clock,
    agents: new Map([["Ann", agent]]),
    settings: { idleReminderDelay: 100 },
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

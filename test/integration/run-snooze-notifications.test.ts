import assert from "node:assert/strict";
import { test } from "node:test";
import { REMINDER_SNOOZE_MS, snoozeReminders } from "../../src/broker/reminder-snooze.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { IDLE_REMINDER_HEADER } from "../../src/constants.js";
import { listFreshComments } from "../../src/store/wall-coverage.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  recipientStatus,
  voteAll,
  waitFor,
  waitForWorkersIdle,
} from "./run-fixture.js";

test(
  "five-minute snooze leaves real comment delivery active and wakes again at expiry",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle, {
      reminders: { idleReminderDelay: 100, idleReminderDigestSize: 2 },
      // Avoid thousands of unrelated database polls during the five-minute jump.
      timings: { completionCheckMs: 1000, progressMs: 1000, heartbeatMs: 1000 },
    });
    const clock = new FakeClock();
    const cancel = new AbortController();
    const outcome = startSwarm(
      { ...run.env, clock },
      {
        name: "snooze-notifications",
        taskPrompt: "Preserve meaningful comment delivery while snoozing reminders.",
        acceptanceCriteria: ["Only reminders pause, then resume after five minutes."],
        agentAmount: 1,
      },
      { signal: cancel.signal },
    );
    const swarmId = newestSwarmId(run.db);
    const [name] = agentNames(run.db, swarmId);
    clock.advance(0);
    try {
      await waitForWorkersIdle(run, swarmId);
      const reminders = () => promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER));
      const until = snoozeReminders(run.db, swarmId, name, clock.now());
      assert.equal(until - clock.now(), REMINDER_SNOOZE_MS);
      clock.advance(100);
      assert.equal(reminders().length, 0);
      const post = createPost(
        run.db,
        swarmId,
        name,
        { title: "Evidence", text: "fresh post during snooze" },
        clock.now(),
      );
      const comment = addComment(
        run.db,
        swarmId,
        "User",
        post.id,
        "This real comment must wake the snoozed worker.",
        clock.now(),
      ).comment;
      const row = run.db.sql
        .prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?")
        .get(comment.id);
      assert.ok(row && typeof row.message_id === "number");
      const notificationId = row.message_id;
      clock.advance(50);
      await waitFor(
        () => recipientStatus(run.db, notificationId, name) === "read",
        "subscribed comment observed during snooze",
      );
      await waitForWorkersIdle(run, swarmId);
      assert.equal(listFreshComments(run.db, swarmId, name, post.id, 10).total, 0);
      assert.ok(
        promptTexts(run.fake).some(
          (text) => text.includes(`Comment #${comment.id} on post #${post.id} by User:`) && text.includes(comment.text),
        ),
      );
      clock.advance(until - clock.now() - 1);
      // Finish the async control poll before entering the deadline's timer phase.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(reminders().length, 0, "no reminder before the five-minute deadline");
      clock.advance(1);
      await waitFor(() => reminders().length === 1, "reminder at snooze expiry");
      assert.doesNotMatch(reminders()[0], /This real comment must wake/);
      assert.match(reminders()[0], /fresh post during snooze/);
      voteAll(run.db, swarmId, "accepted", "Comment delivery and snooze deadline verified.");
      clock.advance(1000);
      assert.equal((await outcome).end, "finished");
    } finally {
      cancel.abort();
      await outcome;
      run.cleanup();
    }
  },
);

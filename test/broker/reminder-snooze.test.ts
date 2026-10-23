import assert from "node:assert/strict";
import { test } from "node:test";
import { snoozeReminders, reminderSnoozedUntil, REMINDER_SNOOZE_MS } from "../../src/broker/reminder-snooze.js";
import { sendMessage } from "../../src/broker/messages.js";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { workerHasIdled } from "../../src/broker/worker-eligibility.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("snooze persists the exact five-minute deadline, isolated by worker and swarm", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    const other = seedSwarm(temp.db);
    assert.equal(reminderSnoozedUntil(temp.db, swarm.id, "Maria"), 0);
    assert.equal(workerHasIdled(temp.db, swarm.id, "Maria"), false);
    assert.throws(() => snoozeReminders(temp.db, swarm.id, "Maria", T0), /first idle/);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0);
    assert.equal(workerHasIdled(temp.db, swarm.id, "Maria"), true);
    const until = snoozeReminders(temp.db, swarm.id, "maria", T0);
    assert.equal(until, T0 + 300_000);
    assert.equal(REMINDER_SNOOZE_MS, 300_000);
    assert.equal(reminderSnoozedUntil(temp.db, swarm.id, "Maria"), until);
    assert.equal(reminderSnoozedUntil(temp.db, swarm.id, "John"), 0);
    assert.equal(reminderSnoozedUntil(temp.db, other.id, "Maria"), 0);
    const reopened = openSwarmDb(temp.db.path, { create: false });
    try {
      assert.equal(reminderSnoozedUntil(reopened, swarm.id, "Maria"), until);
      assert.equal(snoozeReminders(reopened, swarm.id, "Maria", T0 + 10), T0 + 300_010);
      assert.equal(snoozeReminders(temp.db, swarm.id, "Maria", T0 + 1), T0 + 300_010);
    } finally {
      reopened.close();
    }
  } finally {
    temp.cleanup();
  }
});

test("snooze leaves pending real messages and acceptance unchanged and joins rollback", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    const message = sendMessage(temp.db, swarm.id, "User", ["Maria"], "Real work still wakes you", T0);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0);
    setAgentStatus(temp.db, swarm.id, "John", "idle", T0);
    const before = temp.db.sql.prepare("SELECT * FROM message_recipients WHERE message_id = ?").all(message.id);
    const votes = temp.db.sql.prepare("SELECT * FROM acceptance_votes WHERE swarm_id = ?").all(swarm.id);
    snoozeReminders(temp.db, swarm.id, "Maria", T0);
    assert.deepEqual(
      temp.db.sql.prepare("SELECT * FROM message_recipients WHERE message_id = ?").all(message.id),
      before,
    );
    assert.deepEqual(temp.db.sql.prepare("SELECT * FROM acceptance_votes WHERE swarm_id = ?").all(swarm.id), votes);
    assert.throws(
      () =>
        temp.db.write(() => {
          snoozeReminders(temp.db, swarm.id, "John", T0);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(reminderSnoozedUntil(temp.db, swarm.id, "John"), 0);
  } finally {
    temp.cleanup();
  }
});

test("only registered workers in active swarms can request snooze", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    for (const name of ["Watcher", "User", "Main"]) {
      assert.throws(() => snoozeReminders(temp.db, swarm.id, name, T0), /Only worker agents/);
    }
    assert.throws(() => snoozeReminders(temp.db, swarm.id, "missing", T0), /Unknown participant/);
    assert.throws(() => snoozeReminders(temp.db, 999, "Maria", T0), /not found/);
    assert.throws(() => snoozeReminders(temp.db, swarm.id, "Maria", Number.NaN), /timestamp/);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0);
    temp.db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(swarm.id);
    assert.throws(() => snoozeReminders(temp.db, swarm.id, "Maria", T0), /while the swarm is running/);
  } finally {
    temp.cleanup();
  }
});

test("additive v10 upgrade preserves pending messages and starts with no snoozes", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    const message = sendMessage(temp.db, swarm.id, "User", ["Maria"], "Preserve me", T0);
    temp.db.sql.exec(`DROP TABLE reminder_snoozes;
      DROP TABLE configuration_requests; DROP TABLE run_configuration_revisions;
      DROP TABLE replacement_post_baselines; DROP TABLE replacement_handoffs;
      DROP INDEX participants_active_roster; DROP INDEX participants_retired_history;
      ALTER TABLE usage DROP COLUMN cost_input;
      ALTER TABLE usage DROP COLUMN cost_output;
      ALTER TABLE usage DROP COLUMN cost_cache_read;
      ALTER TABLE usage DROP COLUMN cost_cache_write;
      ALTER TABLE participants DROP COLUMN retired_at;
      ALTER TABLE participants DROP COLUMN first_idle_at;
      ALTER TABLE participants DROP COLUMN retired_provider;
      ALTER TABLE participants DROP COLUMN retired_model_id;
      ALTER TABLE participants DROP COLUMN retired_thinking_level;
      PRAGMA user_version = 10;`);
    const upgraded = openSwarmDb(temp.db.path, { create: false });
    try {
      assert.equal(upgraded.sql.prepare("PRAGMA user_version").get()?.user_version, 14);
      assert.equal(reminderSnoozedUntil(upgraded, swarm.id, "Maria"), 0);
      assert.equal(
        upgraded.sql.prepare("SELECT status FROM message_recipients WHERE message_id = ?").get(message.id)?.status,
        "pending",
      );
      setAgentStatus(upgraded, swarm.id, "Maria", "idle", T0);
      assert.equal(snoozeReminders(upgraded, swarm.id, "Maria", T0), T0 + 300_000);
    } finally {
      upgraded.close();
    }
  } finally {
    temp.cleanup();
  }
});

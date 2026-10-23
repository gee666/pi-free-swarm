import { WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { int, text } from "../store/rows.js";
import { BrokerError } from "./errors.js";
import { actAs, requireParticipant, requireSwarm } from "./validate.js";

export const REMINDER_SNOOZE_MS = 5 * 60 * 1000;

/** Only idle reminders pause. Durable messages, subscriptions and votes are unchanged. */
export function snoozeReminders(db: SwarmDb, swarmId: number, name: string, now: number): number {
  const until = now + REMINDER_SNOOZE_MS;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(until)) {
    throw new BrokerError("validation", "Reminder snooze requires a valid current timestamp.");
  }
  return db.write(() => {
    requireSwarm(db, swarmId);
    const participant = requireParticipant(db, swarmId, name);
    if (participant.kind !== "agent" || participant.name === WATCHER_NAME) {
      throw new BrokerError("validation", "Only worker agents may snooze their idle reminders.");
    }
    const swarm = db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(swarmId);
    if (!swarm || !["starting", "running"].includes(text(swarm, "status"))) {
      throw new BrokerError("validation", "Idle reminders can only be snoozed while the swarm is running.");
    }
    const worker = actAs(db, swarmId, participant.name, now);
    db.sql
      .prepare(
        `INSERT INTO reminder_snoozes (swarm_id, name, until_at) VALUES (?, ?, ?)
      ON CONFLICT (swarm_id, name) DO UPDATE SET until_at = MAX(reminder_snoozes.until_at, excluded.until_at)`,
      )
      .run(swarmId, worker.name, until);
    return reminderSnoozedUntil(db, swarmId, worker.name);
  });
}

export function reminderSnoozedUntil(db: SwarmDb, swarmId: number, name: string): number {
  const row = db.sql
    .prepare("SELECT until_at FROM reminder_snoozes WHERE swarm_id = ? AND name = ?")
    .get(swarmId, name);
  return row ? int(row, "until_at") : 0;
}

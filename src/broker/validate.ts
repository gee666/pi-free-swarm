// Input checks shared by the broker writes. Every failure is a BrokerError with the exact user-facing text.
import { checkText, checkTitle, TEXT_MAX } from "../limits.js";
import { PAGE_MAX_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { intOrNull } from "../store/rows.js";
import { findParticipant, type ParticipantRef } from "../store/swarm-queries.js";
import { emitParticipantUpdated } from "./emit.js";
import { BrokerError } from "./errors.js";

export function requireText(raw: string, max: number = TEXT_MAX, field = "text"): string {
  const check = checkText(raw, max);
  if (!check.ok) throw new BrokerError("validation", check.error, field);
  return check.value;
}

export function requireTitle(raw: string): string {
  const check = checkTitle(raw);
  if (!check.ok) throw new BrokerError("validation", check.error, "title");
  return check.value;
}

export function checkPage(page: { count: number; offset: number }): void {
  if (!Number.isInteger(page.count) || page.count < 1 || page.count > PAGE_MAX_COUNT) {
    throw new BrokerError("validation", `count must be an integer 1–${PAGE_MAX_COUNT}.`, "count");
  }
  if (!Number.isInteger(page.offset) || page.offset < 0) {
    throw new BrokerError("validation", "offset must be an integer >= 0.", "offset");
  }
}

export function requireSwarm(db: SwarmDb, swarmId: number): void {
  if (db.sql.prepare("SELECT 1 FROM swarms WHERE id = ?").get(swarmId) === undefined) {
    throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
  }
}

/** Resolves a participant case-insensitively to its canonical name. */
export function requireParticipant(db: SwarmDb, swarmId: number, name: string): ParticipantRef {
  const participant = findParticipant(db, swarmId, name);
  if (participant === null) throw new BrokerError("validation", `Unknown participant: ${name}.`);
  return participant;
}

/**
 * The acting participant of a write: records its activity and, the first time, when it joined
 * (the UI's "discovered on the board").
 */
export function actAs(db: SwarmDb, swarmId: number, name: string, now: number): ParticipantRef {
  const participant = requireParticipant(db, swarmId, name);
  const row = db.sql
    .prepare("SELECT joined_at FROM participants WHERE swarm_id = ? AND name = ?")
    .get(swarmId, participant.name);
  const joined = row !== undefined && intOrNull(row, "joined_at") !== null;
  db.sql
    .prepare(
      "UPDATE participants SET last_activity_at = ?, joined_at = COALESCE(joined_at, ?) WHERE swarm_id = ? AND name = ?",
    )
    .run(now, now, swarmId, participant.name);
  if (!joined) emitParticipantUpdated(db, swarmId, participant.name, now);
  return participant;
}

import { WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { BrokerError } from "./errors.js";
import { requireParticipant } from "./validate.js";

/** First idle belongs to the worker identity, not a single recovered process. */
export function workerHasIdled(db: SwarmDb, swarmId: number, name: string): boolean {
  return (
    db.sql
      .prepare(
        `SELECT 1 FROM participants
    WHERE swarm_id = ? AND name = ? AND kind = 'agent' AND name != ?
      AND retired_at IS NULL AND first_idle_at IS NOT NULL`,
      )
      .get(swarmId, name, WATCHER_NAME) !== undefined
  );
}

export function requireIdleWorker(db: SwarmDb, swarmId: number, name: string): string {
  const participant = requireParticipant(db, swarmId, name);
  if (participant.kind !== "agent" || participant.name === WATCHER_NAME) {
    throw new BrokerError("validation", "Only worker agents may use this action.");
  }
  if (!workerHasIdled(db, swarmId, participant.name)) {
    throw new BrokerError("validation", "This action is available to active workers only after their first idle turn.");
  }
  return participant.name;
}

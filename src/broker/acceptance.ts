import { SYSTEM_NAME, USER_NAME, WATCHER_NAME } from "../constants.js";
import type { AcceptanceRecord, AcceptanceVoteVerdict } from "../store/acceptance-types.js";
import { getAcceptance, saveAcceptance, type AcceptanceReadOptions } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { int } from "../store/rows.js";
import { insertEvent } from "../store/events.js";
import { BrokerError } from "./errors.js";
import { requireParticipant, requireSwarm } from "./validate.js";

export interface AcceptanceMutation {
  action: "vote";
  revision?: number;
  verdict: AcceptanceVoteVerdict;
  reason: string;
}

export function inspectAcceptance(db: SwarmDb, swarmId: number, options: AcceptanceReadOptions = {}): AcceptanceRecord {
  requireSwarm(db, swarmId);
  return getAcceptance(db, swarmId, options);
}

/** Call under db.write, including when composing this guard into the runner's close transaction. */
export function acceptanceRun(db: SwarmDb, swarmId: number): number {
  const row = db.sql
    .prepare(
      `SELECT s.run_count, s.status, a.closed_run, r.ended_at FROM swarms s
    JOIN acceptance a ON a.swarm_id = s.id
    JOIN swarm_runs r ON r.swarm_id = s.id AND r.run = s.run_count WHERE s.id = ?`,
    )
    .get(swarmId);
  if (
    !row ||
    !["starting", "running"].includes(String(row.status)) ||
    row.ended_at !== null ||
    row.closed_run === row.run_count
  ) {
    throw new BrokerError("validation", "Acceptance admission is closed for this run.");
  }
  return int(row, "run_count");
}

export function requireAcceptanceRevision(record: AcceptanceRecord, revision: number): void {
  if (!Number.isSafeInteger(revision) || revision !== record.revision) {
    throw new BrokerError(
      "validation",
      `Stale acceptance revision; inspect revision ${record.revision} before retrying.`,
    );
  }
}

export function mutateAcceptance(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  mutation: AcceptanceMutation,
  now: number,
  expectedRun?: number,
): AcceptanceRecord {
  return db.write(() => {
    const run = acceptanceRun(db, swarmId);
    if (expectedRun !== undefined && (!Number.isSafeInteger(expectedRun) || expectedRun !== run))
      throw new BrokerError("validation", "Agent belongs to a different swarm run; acceptance vote rejected.");
    const participant = requireParticipant(db, swarmId, actor);
    if (participant.kind !== "agent" || participant.name.toLowerCase() === WATCHER_NAME.toLowerCase())
      throw new BrokerError("validation", "Acceptance votes require a worker agent.");
    const worker = db.sql
      .prepare("SELECT retired_at FROM participants WHERE swarm_id = ? AND name = ?")
      .get(swarmId, participant.name);
    if (!worker || worker.retired_at !== null)
      throw new BrokerError("validation", "Removed workers cannot vote on the active roster.");
    const record = getAcceptance(db, swarmId);
    if (mutation.revision !== undefined) requireAcceptanceRevision(record, mutation.revision);
    if (mutation.action !== "vote")
      throw new BrokerError("validation", 'action must be "vote" to submit a vote.', "action");
    if (!["accepted", "incomplete", "blocked"].includes(mutation.verdict))
      throw new BrokerError("validation", "verdict must be accepted, incomplete or blocked.", "verdict");
    if (typeof mutation.reason !== "string" || !mutation.reason.trim())
      throw new BrokerError(
        "validation",
        "reason must be a nonempty explanation of your whole-task judgment.",
        "reason",
      );
    db.sql
      .prepare(
        `INSERT INTO acceptance_votes (swarm_id, agent, run, verdict, reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (swarm_id, agent) DO UPDATE SET
        run = excluded.run, verdict = excluded.verdict, reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .run(swarmId, participant.name, run, mutation.verdict, mutation.reason.trim(), now);
    recordChange(db, record, participant.name, now);
    return getAcceptance(db, swarmId);
  });
}

/** Join the roster mutation transaction so counts, revision and outbox commit together. */
export function recordRosterAcceptanceChange(
  db: SwarmDb,
  swarmId: number,
  now: number,
  actor = USER_NAME,
): AcceptanceRecord {
  return db.write(() => {
    acceptanceRun(db, swarmId);
    const record = getAcceptance(db, swarmId);
    recordChange(db, record, actor, now);
    return getAcceptance(db, swarmId);
  });
}

/** Seals admission before shutdown; cleanup may repeat the same seal after the run ends. */
export function sealAcceptance(db: SwarmDb, swarmId: number, run: number, revision: number): void {
  db.write(() => {
    const row = db.sql
      .prepare("SELECT s.run_count, a.closed_run FROM swarms s JOIN acceptance a ON a.swarm_id = s.id WHERE s.id = ?")
      .get(swarmId);
    if (!row || int(row, "run_count") !== run)
      throw new BrokerError("validation", "Run changed before acceptance closure.");
    requireAcceptanceRevision(getAcceptance(db, swarmId), revision);
    if (row.closed_run === run) return;
    acceptanceRun(db, swarmId);
    db.sql.prepare("UPDATE acceptance SET closed_run = ? WHERE swarm_id = ?").run(run, swarmId);
  });
}

/** A dead agent's vote must not survive its process, but sealed results cannot change. */
export function invalidateAgentVote(
  db: SwarmDb,
  swarmId: number,
  run: number,
  agent: string,
  reason: string,
  now: number,
): boolean {
  return db.write(() => {
    const vote = db.sql
      .prepare(
        `SELECT 1 FROM acceptance_votes v JOIN acceptance a ON a.swarm_id = v.swarm_id
        JOIN swarms s ON s.id = v.swarm_id
        JOIN participants p ON p.swarm_id = v.swarm_id AND p.name = v.agent AND p.retired_at IS NULL
        WHERE v.swarm_id = ? AND v.agent = ? AND v.run = ? AND s.run_count = ?
        AND (a.closed_run IS NULL OR a.closed_run != ?)`,
      )
      .get(swarmId, agent, run, run, run);
    if (!vote) return false;
    if (!reason.trim()) throw new BrokerError("validation", "Vote invalidation requires a reason.");
    const record = getAcceptance(db, swarmId);
    db.sql
      .prepare("DELETE FROM acceptance_votes WHERE swarm_id = ? AND agent = ? AND run = ?")
      .run(swarmId, agent, run);
    recordChange(db, record, SYSTEM_NAME, now);
    return true;
  });
}

/** Resume clears active judgments; retired workers' historical votes remain stored. */
export function resetAcceptanceVotes(db: SwarmDb, swarmId: number, now: number): AcceptanceRecord {
  return db.write(() => {
    const record = inspectAcceptance(db, swarmId);
    db.sql
      .prepare(
        `DELETE FROM acceptance_votes WHERE swarm_id = ? AND agent IN
      (SELECT name FROM participants WHERE swarm_id = ? AND retired_at IS NULL)`,
      )
      .run(swarmId, swarmId);
    recordChange(db, record, SYSTEM_NAME, now);
    return getAcceptance(db, swarmId);
  });
}

function recordChange(db: SwarmDb, record: AcceptanceRecord, actor: string, now: number): void {
  record.revision++;
  record.updatedBy = actor;
  record.updatedAt = now;
  saveAcceptance(db, record);
  insertEvent(db, record.swarmId, "acceptance.updated", { revision: record.revision }, now);
}

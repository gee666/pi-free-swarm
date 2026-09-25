import { Value } from "typebox/value";
import { AcceptancePayload, type AcceptanceRecord } from "../store/acceptance-types.js";
import { getAcceptance, saveAcceptance } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { int } from "../store/rows.js";
import { insertEvent } from "../store/events.js";
import { BrokerError } from "./errors.js";
import { requireParticipant, requireSwarm } from "./validate.js";

export type AcceptanceMutation =
  | { action: "claim" | "release"; revision: number }
  | {
      action: "update";
      revision: number;
      verdict: "checking" | "accepted" | "incomplete" | "blocked";
      payload: AcceptancePayload;
    }
  | { action: "challenge"; revision: number; finding: string };

export function inspectAcceptance(db: SwarmDb, swarmId: number): AcceptanceRecord {
  requireSwarm(db, swarmId);
  return getAcceptance(db, swarmId);
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
): AcceptanceRecord {
  return db.write(() => {
    const run = acceptanceRun(db, swarmId);
    const participant = requireParticipant(db, swarmId, actor);
    if (participant.kind !== "agent") throw new BrokerError("validation", "Acceptance mutations require a swarm peer.");
    const record = inspectAcceptance(db, swarmId);
    requireAcceptanceRevision(record, mutation.revision);
    switch (mutation.action) {
      case "claim":
        if (record.claimant !== null)
          throw new BrokerError("validation", `Acceptance is claimed by ${record.claimant}.`);
        record.verdict = "checking";
        record.claimant = participant.name;
        record.claimRun = run;
        break;
      case "release":
      case "update":
        if (record.claimant !== participant.name || record.claimRun !== run) {
          throw new BrokerError("validation", "Self-claim acceptance in this run before updating it.");
        }
        if (mutation.action === "release") record.verdict = "unchecked";
        else if (mutation.action === "update") {
          validateJudgment(mutation);
          record.evidence = mutation.payload.evidence;
          record.knownGaps = mutation.payload.knownGaps;
          record.findings = mutation.payload.findings;
          record.verdict = mutation.verdict;
        }
        break;
      case "challenge": {
        const finding = mutation.finding.trim();
        if (!finding)
          throw new BrokerError(
            "validation",
            "Challenge must name an unmet requirement and actionable evidence or decision needed.",
          );
        if (record.findings.includes(finding))
          throw new BrokerError("validation", "This finding is already unresolved.");
        record.findings = [...record.findings, finding];
        record.knownGaps = [...record.knownGaps, finding];
        record.verdict = "incomplete";
        break;
      }
    }
    if (record.verdict !== "checking") {
      record.claimant = null;
      record.claimRun = null;
    }
    record.revision++;
    record.updatedBy = participant.name;
    record.updatedAt = now;
    saveAcceptance(db, record);
    insertEvent(db, swarmId, "acceptance.updated", { revision: record.revision }, now);
    return record;
  });
}

function validateJudgment(mutation: Extract<AcceptanceMutation, { action: "update" }>): void {
  if (!Value.Check(AcceptancePayload, mutation.payload))
    throw new BrokerError("validation", "Supply evidence, knownGaps and findings arrays.");
  const { evidence, findings, knownGaps } = mutation.payload;
  if (mutation.verdict !== "checking" && evidence.length === 0) {
    throw new BrokerError(
      "validation",
      "Final judgments require inspectable evidence, including failed checks or blocker references.",
    );
  }
  if (evidence.some((item) => (item.command === undefined) !== (item.cwd === undefined))) {
    throw new BrokerError("validation", "Command evidence requires both command and cwd.");
  }
  if (mutation.verdict === "accepted" && (findings.length > 0 || knownGaps.length > 0)) {
    throw new BrokerError(
      "validation",
      "Accepted requires no unresolved findings or known gaps against the original task.",
    );
  }
  if (["incomplete", "blocked"].includes(mutation.verdict) && (findings.length === 0 || knownGaps.length === 0)) {
    throw new BrokerError("validation", "Incomplete/blocked requires concrete findings and known gaps.");
  }
}

/** Rejects subsequent acceptance writes before asynchronous shutdown. Does not close message admission. */
export function sealAcceptance(db: SwarmDb, swarmId: number, run: number, revision: number): void {
  db.write(() => {
    if (acceptanceRun(db, swarmId) !== run)
      throw new BrokerError("validation", "Run changed before acceptance closure.");
    requireAcceptanceRevision(getAcceptance(db, swarmId), revision);
    db.sql.prepare("UPDATE acceptance SET closed_run = ? WHERE swarm_id = ?").run(run, swarmId);
  });
}

/** Runner-only: invoke on checker death, or with its old claimRun before resuming. Never reassigns work. */
export function invalidateAcceptanceClaim(
  db: SwarmDb,
  swarmId: number,
  run: number,
  agent: string,
  reason: string,
  now: number,
): boolean {
  return db.write(() => {
    const record = getAcceptance(db, swarmId);
    if (record.claimRun !== run || record.claimant !== agent) return false;
    const finding = reason.trim();
    if (!finding) throw new BrokerError("validation", "Claim invalidation requires a reason.");
    record.verdict = "incomplete";
    record.claimant = null;
    record.claimRun = null;
    record.findings.push(finding);
    record.knownGaps.push("Acceptance check did not finish.");
    record.evidence.push({ reference: `run:${run}/agent:${agent}`, result: finding });
    record.revision++;
    record.updatedBy = "System";
    record.updatedAt = now;
    saveAcceptance(db, record);
    insertEvent(db, swarmId, "acceptance.updated", { revision: record.revision }, now);
    return true;
  });
}

import type { AcceptanceRecord } from "../store/acceptance-types.js";
import { getAcceptance, saveAcceptance } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { listOpenAgentRecipients } from "../store/message-queries.js";
import { text } from "../store/rows.js";
import { invalidateAcceptanceClaim, sealAcceptance } from "./acceptance.js";
import { queuePendingAcceptance } from "./acceptance-checkpoint.js";
import { notifyLocalMessage } from "./notify.js";

interface RunIdentity {
  swarmId: number;
  run: number;
  runnerPid: number;
  now: number;
}

type CompletionDecision = { kind: "pending" | "notified" | "lost" } | { kind: "closed"; acceptance: AcceptanceRecord };

function ownsRun(db: SwarmDb, input: RunIdentity): boolean {
  return (
    db.sql
      .prepare(
        `SELECT 1 FROM swarms WHERE id = ? AND run_count = ? AND runner_pid = ?
    AND status IN ('starting', 'running')`,
      )
      .get(input.swarmId, input.run, input.runnerPid) !== undefined
  );
}

/** Rechecks DB work and acceptance under the same lock that closes message/acceptance admission. */
export function prepareRunCompletion(
  db: SwarmDb,
  input: RunIdentity & { available: readonly string[]; exhausted: ReadonlySet<string> },
): CompletionDecision {
  const decision = db.write((): CompletionDecision => {
    if (!ownsRun(db, input)) return { kind: "lost" };
    const busy = db.sql
      .prepare(`SELECT name, status FROM participants WHERE swarm_id = ? AND kind = 'agent'`)
      .all(input.swarmId)
      .some((row) => row.status !== "idle" && !(row.status === "crashed" && input.exhausted.has(text(row, "name"))));
    const open = listOpenAgentRecipients(db, input.swarmId).some((row) => !input.exhausted.has(row.name));
    if (busy || open) return { kind: "pending" };
    if (queuePendingAcceptance(db, input.swarmId, input.run, input.available, input.now)) return { kind: "notified" };
    return {
      kind: "closed",
      acceptance: sealCurrentAcceptance(db, input, "Acceptance check settled without a final judgment."),
    };
  });
  if (decision.kind === "notified") notifyLocalMessage(input.swarmId);
  return decision;
}

/** Stop/failure closes admission immediately, without waiting for quiescence or scheduling a check. */
export function closeRunAdmission(db: SwarmDb, input: RunIdentity, reason: string): AcceptanceRecord | null {
  return db.write(() => (ownsRun(db, input) ? sealCurrentAcceptance(db, input, reason) : null));
}

function sealCurrentAcceptance(db: SwarmDb, input: RunIdentity, reason: string): AcceptanceRecord {
  failPendingAcceptance(db, input.swarmId, reason, input.now);
  const record = getAcceptance(db, input.swarmId);
  sealAcceptance(db, input.swarmId, input.run, record.revision);
  return record;
}

/** Also used by stale-lock cleanup, where no live runner remains to report a checker failure. */
export function failPendingAcceptance(db: SwarmDb, swarmId: number, reason: string, now: number): void {
  db.write(() => {
    const record = getAcceptance(db, swarmId);
    if (record.claimant !== null && record.claimRun !== null) {
      invalidateAcceptanceClaim(db, swarmId, record.claimRun, record.claimant, reason, now);
    }
  });
}

/** New work invalidates prior acceptance; an interrupted check retains an explicit failure verdict. */
export function reopenAcceptance(db: SwarmDb, swarmId: number, now: number): void {
  db.write(() => {
    const record = getAcceptance(db, swarmId);
    if (record.claimant !== null && record.claimRun !== null) {
      invalidateAcceptanceClaim(
        db,
        swarmId,
        record.claimRun,
        record.claimant,
        "Previous run ended before its acceptance check completed.",
        now,
      );
      return;
    }
    record.verdict = "unchecked";
    record.revision++;
    record.updatedBy = "System";
    record.updatedAt = now;
    saveAcceptance(db, record);
  });
}

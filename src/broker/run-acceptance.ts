import type { AcceptanceRecord } from "../store/acceptance-types.js";
import { getAcceptance } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { resetAcceptanceVotes, sealAcceptance } from "./acceptance.js";

interface RunIdentity {
  swarmId: number;
  run: number;
  runnerPid: number;
  now: number;
}

type CompletionDecision = { kind: "pending" | "lost" } | { kind: "closed"; acceptance: AcceptanceRecord };

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

/** Freeze votes under the same lock that closes message and vote admission. */
export function prepareRunCompletion(db: SwarmDb, input: RunIdentity): CompletionDecision {
  return db.write(() => {
    if (!ownsRun(db, input)) return { kind: "lost" };
    const acceptance = getAcceptance(db, input.swarmId);
    if (acceptance.verdict !== "accepted" && acceptance.verdict !== "blocked") return { kind: "pending" };
    sealAcceptance(db, input.swarmId, input.run, acceptance.revision);
    return { kind: "closed", acceptance: getAcceptance(db, input.swarmId, { includeExcludedVotes: true }) };
  });
}

/** Cancellation freezes the actual votes without manufacturing a consensus. */
export function closeRunAdmission(db: SwarmDb, input: RunIdentity): AcceptanceRecord | null {
  return db.write(() => {
    if (!ownsRun(db, input)) return null;
    const acceptance = getAcceptance(db, input.swarmId, { includeExcludedVotes: true });
    sealAcceptance(db, input.swarmId, input.run, acceptance.revision);
    return acceptance;
  });
}

/** Stale-run cleanup freezes votes so a surviving worker cannot keep voting. */
export function freezeRunAcceptance(db: SwarmDb, swarmId: number): void {
  db.write(() => {
    const swarm = db.sql.prepare("SELECT run_count FROM swarms WHERE id = ?").get(swarmId);
    if (!swarm || typeof swarm.run_count !== "number") return;
    const acceptance = getAcceptance(db, swarmId);
    sealAcceptance(db, swarmId, swarm.run_count, acceptance.revision);
  });
}

export function reopenAcceptance(db: SwarmDb, swarmId: number, now: number): void {
  resetAcceptanceVotes(db, swarmId, now);
}

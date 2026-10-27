import type { SwarmDb } from "../store/db.js";
import { getAcceptance } from "../store/acceptance-queries.js";
import type { AcceptanceRecord } from "../store/acceptance-types.js";
import { saveWorkOutcome } from "../store/project.js";
import { insertEvent } from "../store/events.js";
import { evaluateCompletion } from "./completion.js";
import { readRunOwnership } from "./run-ownership.js";
import { sealAcceptance } from "./acceptance.js";

export function prepareWorkRunCompletion(
  db: SwarmDb,
  input: { swarmId: number; run: number; runnerPid: number; now: number },
): { kind: "pending" | "lost" } | { kind: "closed"; acceptance: AcceptanceRecord } {
  return db.write(() => {
    if (readRunOwnership(db, input.swarmId, input.run, input.runnerPid) === "lost") return { kind: "lost" };
    const completion = evaluateCompletion(db, input.swarmId);
    if (!completion.done) return { kind: "pending" };
    saveWorkOutcome(db, input.swarmId, completion.outcome);
    insertEvent(db, input.swarmId, "project.changed", { id: input.swarmId }, input.now);
    // Admission fencing remains until the legacy acceptance transport is removed.
    const acceptance = getAcceptance(db, input.swarmId);
    sealAcceptance(db, input.swarmId, input.run, acceptance.revision);
    return { kind: "closed", acceptance: getAcceptance(db, input.swarmId, { includeExcludedVotes: true }) };
  });
}

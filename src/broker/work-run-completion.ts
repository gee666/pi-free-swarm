import type { SwarmDb } from "../store/db.js";
import { saveWorkOutcome } from "../store/project.js";
import { insertEvent } from "../store/events.js";
import { evaluateCompletion } from "./completion.js";
import { readRunOwnership } from "./run-ownership.js";
import { closeRunAdmission } from "./run-admission.js";

export function prepareWorkRunCompletion(
  db: SwarmDb,
  input: { swarmId: number; run: number; runnerPid: number; now: number },
): { kind: "pending" | "lost" | "closed" } {
  return db.write(() => {
    if (readRunOwnership(db, input.swarmId, input.run, input.runnerPid) === "lost") return { kind: "lost" };
    const completion = evaluateCompletion(db, input.swarmId);
    if (!completion.done) return { kind: "pending" };
    saveWorkOutcome(db, input.swarmId, completion.outcome);
    insertEvent(db, input.swarmId, "project.changed", { id: input.swarmId }, input.now);
    closeRunAdmission(db, input.swarmId, input.run, input.runnerPid);
    return { kind: "closed" };
  });
}

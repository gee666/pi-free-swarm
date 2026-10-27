import type { SwarmDb } from "../store/db.js";
import { saveWorkOutcome } from "../store/project.js";
import { insertEvent } from "../store/events.js";
import { evaluateCompletion } from "./completion.js";
import { readRunOwnership } from "./run-ownership.js";
import { closeRunAdmission } from "./run-admission.js";

export function commitWorkRunCompletion(db: SwarmDb, swarmId: number, now: number): boolean {
  const completion = evaluateCompletion(db, swarmId);
  saveWorkOutcome(db, swarmId, completion.outcome);
  if (!completion.done) db.sql.prepare("UPDATE swarms SET admission_closed_run = NULL WHERE id = ?").run(swarmId);
  insertEvent(db, swarmId, "project.changed", { id: swarmId }, now);
  return completion.done;
}

export function prepareWorkRunCompletion(
  db: SwarmDb,
  input: { swarmId: number; run: number; runnerPid: number; now: number },
): { kind: "pending" | "lost" | "closed" } {
  return db.write(() => {
    if (readRunOwnership(db, input.swarmId, input.run, input.runnerPid) === "lost") return { kind: "lost" };
    const completion = evaluateCompletion(db, input.swarmId);
    if (!completion.done) return { kind: "pending" };
    closeRunAdmission(db, input.swarmId, input.run, input.runnerPid);
    return { kind: "closed" };
  });
}

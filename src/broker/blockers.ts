import type { CriterionBlocker } from "../api-work-types.js";
import { getBlocker, saveBlocker, addCriterionEvent, type BlockerFields } from "../store/criteria.js";
import type { SwarmDb } from "../store/db.js";
import { assessCriterion } from "./criterion-status.js";
import { BrokerError } from "./errors.js";
import { storedWorkText } from "./work-text.js";
import { checkRevision, requireCriterion, userOnly, type RevisionInput, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";

export function recordCriterionBlocker(
  db: SwarmDb,
  input: WorkInput & RevisionInput & BlockerFields & { criterionId: number },
): CriterionBlocker {
  return writeWork(db, input, (actor) => {
    requireCriterion(db, input.swarmId, input.criterionId);
    const old = getBlocker(db, input.criterionId);
    checkRevision(old?.revision ?? 0, input.expectedRevision);
    const blocker: CriterionBlocker = {
      criterionId: input.criterionId,
      revision: (old?.revision ?? 0) + 1,
      reason: storedWorkText(db, input.swarmId, input.reason, "reason", actor),
      missing: storedWorkText(db, input.swarmId, input.missing, "missing", actor),
      attempted: storedWorkText(db, input.swarmId, input.attempted, "attempted", actor),
      unblock: storedWorkText(db, input.swarmId, input.unblock, "unblock", actor),
      author: actor,
      updatedAt: input.now,
      rejectedRevision: null,
      decidedAt: null,
    };
    saveBlocker(db, blocker);
    addCriterionEvent(db, input.swarmId, input.criterionId, actor, "blocker_recorded", blocker.reason, input.now);
    return blocker;
  });
}
export function decideCriterionBlocker(
  db: SwarmDb,
  input: WorkInput & RevisionInput & { criterionId: number; decision: "reject" },
): CriterionBlocker {
  return writeWork(db, input, (actor) => {
    userOnly(actor);
    requireCriterion(db, input.swarmId, input.criterionId);
    const blocker = getBlocker(db, input.criterionId);
    if (!blocker) throw new BrokerError("not_found", "No blocker record. Record one and collect blocked votes first.");
    checkRevision(blocker.revision, input.expectedRevision);
    if (input.decision !== "reject") throw new BrokerError("validation", "Decision must be reject.");
    const assessment = assessCriterion(db, input.swarmId, input.criterionId);
    if (assessment.status !== "blocked")
      throw new BrokerError(
        "validation",
        "Required owners and an independent voter must agree with current blocked votes before User rejects it.",
      );
    const updated: CriterionBlocker = {
      ...blocker,
      rejectedRevision: blocker.revision,
      decidedAt: input.now,
    };
    saveBlocker(db, updated);
    addCriterionEvent(db, input.swarmId, input.criterionId, actor, "blocker_decided", input.decision, input.now);
    return updated;
  });
}

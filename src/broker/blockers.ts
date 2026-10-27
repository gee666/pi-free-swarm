import type { CriterionBlocker } from "../api-work-types.js";
import { getBlocker, saveBlocker, type BlockerFields } from "../store/criteria.js";
import type { SwarmDb } from "../store/db.js";
import { assessCriterion } from "./criterion-status.js";
import { BrokerError } from "./errors.js";
import { notifyBlockerDecision } from "./work-notifications.js";
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
      approvedRevision: null,
      rejectedRevision: null,
      decidedAt: null,
    };
    saveBlocker(db, blocker);
    return blocker;
  });
}
export function decideCriterionBlocker(
  db: SwarmDb,
  input: WorkInput & RevisionInput & { criterionId: number; decision: "approve" | "reject" },
): CriterionBlocker {
  return writeWork(db, input, (actor) => {
    userOnly(actor);
    requireCriterion(db, input.swarmId, input.criterionId);
    const blocker = getBlocker(db, input.criterionId);
    if (!blocker) throw new BrokerError("not_found", "No blocker record. Record one and collect blocked votes first.");
    checkRevision(blocker.revision, input.expectedRevision);
    if (input.decision !== "approve" && input.decision !== "reject")
      throw new BrokerError("validation", "Decision must be approve or reject.");
    const assessment = assessCriterion(db, input.swarmId, input.criterionId);
    if (assessment.status !== "blocked")
      throw new BrokerError(
        "validation",
        "Required owners and an independent voter must agree with current blocked votes before User decides.",
      );
    if (assessment.exception === (input.decision === "approve" ? "approved" : "rejected"))
      throw new BrokerError("validation", "This blocker decision is already recorded.");
    const updated: CriterionBlocker = {
      ...blocker,
      approvedRevision: input.decision === "approve" ? blocker.revision : null,
      rejectedRevision: input.decision === "reject" ? blocker.revision : null,
      decidedAt: input.now,
    };
    saveBlocker(db, updated);
    notifyBlockerDecision(db, input.swarmId, input.criterionId, input.decision, input.now);
    return updated;
  });
}

import type { CriterionVote, VoteVerdict } from "../api-work-types.js";
import { getBlocker, saveVote, criterionTasks, addCriterionEvent } from "../store/criteria.js";
import type { SwarmDb } from "../store/db.js";
import { BrokerError } from "./errors.js";
import { linksSignature } from "./criterion-status.js";
import { storedWorkText } from "./work-text.js";
import { checkRevision, requireCriterion, type RevisionInput, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";

export function voteCriterion(
  db: SwarmDb,
  input: WorkInput & RevisionInput & { criterionId: number; verdict: VoteVerdict; reason: string },
): CriterionVote {
  return writeWork(db, input, (actor) => {
    const criterion = requireCriterion(db, input.swarmId, input.criterionId);
    checkRevision(criterion.revision, input.expectedRevision);
    if (!["satisfied", "incomplete", "blocked"].includes(input.verdict))
      throw new BrokerError("validation", "Unknown vote verdict.");
    const tasks = criterionTasks(db, criterion.id);
    const blocker = getBlocker(db, criterion.id);
    if (input.verdict === "satisfied" && tasks.some((task) => task.status !== "accepted")) {
      throw new BrokerError(
        "validation",
        "A satisfied vote requires all linked tasks accepted. Finish and review the tasks first.",
      );
    }
    if (input.verdict === "blocked" && blocker === null)
      throw new BrokerError("validation", "A blocked vote requires a blocker record. Call swarm_criteria_block first.");
    if (input.verdict === "blocked" && blocker !== null && blocker.rejectedRevision === blocker.revision)
      throw new BrokerError(
        "validation",
        "This blocker was rejected. Keep working or record a revised blocker before voting blocked.",
      );
    const vote: CriterionVote = {
      criterionId: criterion.id,
      voter: actor,
      verdict: input.verdict,
      reason: storedWorkText(db, input.swarmId, input.reason, "reason", actor),
      criterionRevision: criterion.revision,
      linksSignature: linksSignature(tasks),
      blockerRevision: input.verdict === "blocked" ? (blocker?.revision ?? null) : null,
      createdAt: input.now,
    };
    saveVote(db, vote);
    addCriterionEvent(db, input.swarmId, criterion.id, actor, "voted", `${vote.verdict}: ${vote.reason}`, input.now);
    return vote;
  });
}

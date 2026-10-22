import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { inspectAcceptance, mutateAcceptance } from "../broker/acceptance.js";
import { BrokerError } from "../broker/errors.js";
import { requireParticipant } from "../broker/validate.js";
import type { SwarmDb } from "../store/db.js";

const revision = Type.Integer({
  minimum: 0,
  description: "Optional optimistic concurrency check against the current shared revision.",
});
const verdict = Type.Union([Type.Literal("accepted"), Type.Literal("incomplete"), Type.Literal("blocked")]);
const reason = Type.String({
  minLength: 1,
  pattern: "\\S",
  description: "Free-form explanation of your vote against the whole original task.",
});
const voteOperation = Type.Object({
  action: Type.Literal("vote"),
  revision: Type.Optional(revision),
  verdict,
  reason,
});
// Providers require an object at the root; action-specific requirements are checked below.
export const acceptanceToolParameters = Type.Object({
  action: Type.Union([Type.Literal("inspect"), Type.Literal("vote")]),
  revision: Type.Optional(revision),
  verdict: Type.Optional(verdict),
  reason: Type.Optional(reason),
});

export const acceptanceToolDescription =
  "Inspect acceptance votes or submit your own accepted, incomplete or blocked vote with a free-form reason. " +
  "Your latest vote replaces your previous vote. Judge the whole original task, not just your own work. " +
  "Accepted or blocked requires matching votes from at least ceil(registered worker agents * 0.70); Watcher does not vote. Incomplete is not terminal. " +
  "Inspect returns the original task, acceptance criteria, individual votes, counts and threshold. " +
  "Reasons need no structured evidence or criterion-by-criterion assessment.";

/** Pi-independent handler; the registering adapter owns tool result/error formatting. */
export function executeAcceptanceTool(
  db: SwarmDb,
  swarmId: number,
  agent: string,
  input: Static<typeof acceptanceToolParameters>,
  now: number,
  expectedRun: number,
) {
  requireParticipant(db, swarmId, agent);
  if (input.action !== "inspect" && input.action !== "vote")
    throw new BrokerError("validation", 'action must be "inspect" or "vote".', "action");
  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0))
    throw new BrokerError(
      "validation",
      "revision must be an integer >= 0; omit it when no revision check is needed.",
      "revision",
    );
  if (input.action === "inspect") return inspectAcceptance(db, swarmId);
  if (input.verdict === undefined || !["accepted", "incomplete", "blocked"].includes(input.verdict))
    throw new BrokerError(
      "validation",
      'verdict is required for action "vote"; choose accepted, incomplete or blocked.',
      "verdict",
    );
  if (typeof input.reason !== "string" || !input.reason.trim())
    throw new BrokerError(
      "validation",
      'reason is required for action "vote"; supply a nonempty explanation of your whole-task judgment.',
      "reason",
    );
  if (!Value.Check(voteOperation, input))
    throw new BrokerError("validation", "Vote fields must match the acceptance tool schema.");
  if (!Number.isSafeInteger(expectedRun) || expectedRun < 1)
    throw new BrokerError("validation", "Acceptance votes require a valid agent run identity.");
  return mutateAcceptance(db, swarmId, agent, input, now, expectedRun);
}

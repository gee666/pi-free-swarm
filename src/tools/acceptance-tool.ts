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
  if (input.action === "inspect") return inspectAcceptance(db, swarmId);
  if (!Value.Check(voteOperation, input)) throw new BrokerError("validation", "Invalid acceptance operation.");
  if (!Number.isSafeInteger(expectedRun) || expectedRun < 1)
    throw new BrokerError("validation", "Acceptance votes require a valid agent run identity.");
  return mutateAcceptance(db, swarmId, agent, input, now, expectedRun);
}

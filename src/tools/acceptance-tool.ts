import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { inspectAcceptance, mutateAcceptance } from "../broker/acceptance.js";
import { BrokerError } from "../broker/errors.js";
import { requireParticipant } from "../broker/validate.js";
import { AcceptancePayload } from "../store/acceptance-types.js";
import type { SwarmDb } from "../store/db.js";

const revision = Type.Integer({
  minimum: 0,
  description: "Required for every mutation; use the current record revision.",
});
const verdict = Type.Union([
  Type.Literal("checking"),
  Type.Literal("accepted"),
  Type.Literal("incomplete"),
  Type.Literal("blocked"),
]);
const finding = Type.String({
  minLength: 1,
  description: "Required for challenge: unmet requirement and actionable evidence or decision needed.",
});
const acceptanceOperation = Type.Union([
  Type.Object({ action: Type.Literal("inspect") }),
  Type.Object({ action: Type.Union([Type.Literal("claim"), Type.Literal("release")]), revision }),
  Type.Object({
    action: Type.Literal("update"),
    revision,
    verdict,
    payload: AcceptancePayload,
  }),
  Type.Object({
    action: Type.Literal("challenge"),
    revision,
    finding,
  }),
]);
// Providers require an object at the root; action-specific requirements are checked below.
export const acceptanceToolParameters = Type.Object({
  action: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("claim"),
    Type.Literal("release"),
    Type.Literal("update"),
    Type.Literal("challenge"),
  ]),
  revision: Type.Optional(revision),
  verdict: Type.Optional(verdict),
  payload: Type.Optional(AcceptancePayload),
  finding: Type.Optional(finding),
});

export const acceptanceToolDescription =
  "Inspect or self-claim the shared acceptance check against the whole original task. All peers have identical capabilities; no review quorum. " +
  "Mutations require the current revision; update/release require your own claim. Final judgments require evidence, knownGaps and findings " +
  "(empty arrays explicitly mean none). Incomplete/blocked require concrete gaps/findings. Evidence is agent attestation, not exhaustive proof: " +
  "record reference/result, command with cwd when applicable, and optional supplied artifact/input fingerprint. No automatic artifact validation " +
  "or checksum monitoring occurs. Challenge adds a new actionable finding and invalidates acceptance. Release declines a check without assigning anyone.";

/** Pi-independent handler; the registering adapter owns tool result/error formatting. */
export function executeAcceptanceTool(
  db: SwarmDb,
  swarmId: number,
  agent: string,
  input: Static<typeof acceptanceToolParameters>,
  now: number,
) {
  if (!Value.Check(acceptanceOperation, input)) throw new BrokerError("validation", "Invalid acceptance operation.");
  requireParticipant(db, swarmId, agent);
  return input.action === "inspect" ? inspectAcceptance(db, swarmId) : mutateAcceptance(db, swarmId, agent, input, now);
}

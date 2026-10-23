import { Type, type Static } from "typebox";
import { BrokerError } from "../broker/errors.js";
import { readPostContract, writePostContract } from "../broker/post-contracts.js";
import { BODY_SAFETY_MAX } from "../limits.js";
import type { SwarmDb } from "../store/db.js";

export const postContractParameters = Type.Object({
  post_id: Type.Integer({ minimum: 1 }),
  action: Type.Union([Type.Literal("read"), Type.Literal("write")]),
  text: Type.Optional(
    Type.String({
      minLength: 1,
      pattern: "\\S",
      description: `Document text for write, at most ${BODY_SAFETY_MAX} Unicode characters. No fixed template.`,
    }),
  ),
  expected_revision: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
});

export const postContractDescription =
  "Read or edit an optional shared contract document attached to a wall post. No required template or workflow. Read first to obtain its revision; revision 0 means no document exists. Write requires text and expected_revision. Stale writes are rejected with the current revision: reread and merge before retrying. Reads and writes do not comment, subscribe or send notifications.";

export function executePostContractTool(
  db: SwarmDb,
  swarmId: number,
  name: string,
  params: Static<typeof postContractParameters>,
  now: number,
): string {
  if (params.action === "read") {
    const document = readPostContract(db, swarmId, name, params.post_id);
    return JSON.stringify(document ?? { postId: params.post_id, revision: 0, text: null });
  }
  if (params.text === undefined) throw new BrokerError("validation", "Contract write requires text.", "text");
  if (params.expected_revision === undefined)
    throw new BrokerError(
      "validation",
      "Contract write requires expected_revision. Read the contract first.",
      "expected_revision",
    );
  const document = writePostContract(db, swarmId, name, params.post_id, params.text, params.expected_revision, now);
  return `Saved contract for post #${document.postId} at revision ${document.revision}.`;
}

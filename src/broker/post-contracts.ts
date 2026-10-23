import type { PostContract } from "../api-types.js";
import { BODY_SAFETY_MAX, charCount } from "../limits.js";
import { AGENT_TOOL, SYSTEM_NAME, USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { getPostContract, savePostContract } from "../store/post-contracts.js";
import { listPostClaims } from "../store/post-claims.js";
import { findParticipant } from "../store/swarm-queries.js";
import { postExists } from "../store/wall-queries.js";
import { BrokerError } from "./errors.js";
import { actAs, requireParticipant, requireSwarm } from "./validate.js";
import { createThread, insertMessage } from "./message-insert.js";
import { notifyLocalMessage } from "./notify.js";

export class PostContractConflictError extends BrokerError {
  constructor(
    readonly currentRevision: number,
    expectedRevision: number,
  ) {
    super(
      "validation",
      `Contract revision changed: current revision is ${currentRevision}, expected ${expectedRevision}. Reread the contract and merge your edits before retrying.`,
      "expected_revision",
    );
    this.name = "PostContractConflictError";
  }
}

function notifyClaimants(db: SwarmDb, swarmId: number, contract: PostContract, now: number): void {
  const claimants = new Set(listPostClaims(db, swarmId, contract.postId).map((claim) => claim.agent));
  const recipients = [...claimants].filter((name) => {
    const participant = findParticipant(db, swarmId, name);
    return participant?.kind === "agent" && participant.retiredAt === undefined;
  });
  if (recipients.length === 0) return;
  const threadId = createThread(db, swarmId, [SYSTEM_NAME, ...recipients], now);
  insertMessage(db, {
    swarmId,
    threadId,
    sender: SYSTEM_NAME,
    text: `User updated the contract on post #${contract.postId} to revision ${contract.revision}. Read it with ${AGENT_TOOL.contract}({post_id: ${contract.postId}, action: "read"}).`,
    recipients: recipients.map((name) => ({ name, status: "pending" })),
    now,
  });
}

function requirePost(db: SwarmDb, swarmId: number, postId: number): void {
  requireSwarm(db, swarmId);
  if (!Number.isSafeInteger(postId) || postId < 1)
    throw new BrokerError("validation", "post_id must be a positive integer.", "post_id");
  if (!postExists(db, swarmId, postId)) throw new BrokerError("not_found", `Post #${postId} not found.`);
}

export function readPostContract(db: SwarmDb, swarmId: number, name: string, postId: number): PostContract | null {
  requirePost(db, swarmId, postId);
  requireParticipant(db, swarmId, name);
  return getPostContract(db, swarmId, postId);
}

export function writePostContract(
  db: SwarmDb,
  swarmId: number,
  name: string,
  postId: number,
  text: string,
  expectedRevision: number,
  now: number,
): PostContract {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER)
    throw new BrokerError(
      "validation",
      "expected_revision must be a nonnegative incrementable safe integer.",
      "expected_revision",
    );
  if (typeof text !== "string" || !text.trim() || charCount(text) > BODY_SAFETY_MAX)
    throw new BrokerError(
      "validation",
      `Contract text must be nonblank and at most ${BODY_SAFETY_MAX} characters.`,
      "text",
    );
  const saved = db.write(() => {
    requirePost(db, swarmId, postId);
    const participant = actAs(db, swarmId, name, now);
    if (participant.kind !== "agent" && participant.kind !== "user")
      throw new BrokerError("validation", "Only agents and User can edit post contracts.", "name");
    const currentRevision = getPostContract(db, swarmId, postId)?.revision ?? 0;
    if (expectedRevision !== currentRevision) throw new PostContractConflictError(currentRevision, expectedRevision);
    const contract: PostContract = {
      postId,
      revision: currentRevision + 1,
      text,
      updatedBy: participant.name,
      updatedAt: now,
    };
    savePostContract(db, swarmId, contract);
    insertEvent(db, swarmId, "post.contract.updated", { postId, contract }, now);
    if (participant.name === USER_NAME) notifyClaimants(db, swarmId, contract, now);
    return contract;
  });
  if (saved.updatedBy === USER_NAME) notifyLocalMessage(swarmId);
  return saved;
}

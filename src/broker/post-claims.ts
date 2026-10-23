import type { PostClaim } from "../api-types.js";
import { checkText, TITLE_MAX } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { findPostClaim, insertPostClaim } from "../store/post-claims.js";
import { postExists } from "../store/wall-queries.js";
import { BrokerError } from "./errors.js";
import { actAs, requireSwarm } from "./validate.js";

export function claimPostRole(
  db: SwarmDb,
  swarmId: number,
  name: string,
  postId: number,
  role: string,
  now: number,
): { claimed: boolean; claim: PostClaim } {
  if (!Number.isSafeInteger(postId) || postId < 1)
    throw new BrokerError("validation", "post_id must be a positive integer.", "post_id");
  const checked = checkText(role, TITLE_MAX);
  if (!checked.ok) throw new BrokerError("validation", `Invalid role: ${checked.error}`, "role");
  const chosenRole = checked.value;
  if (/[\r\n]/u.test(chosenRole)) throw new BrokerError("validation", "role must be a single-line name.", "role");
  return db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, name, now);
    if (participant.kind !== "agent") throw new BrokerError("validation", "Only agents can claim post roles.", "name");
    if (!postExists(db, swarmId, postId)) throw new BrokerError("not_found", `Post #${postId} not found.`);
    const claim: PostClaim = { postId, role: chosenRole, agent: participant.name, createdAt: now };
    if (insertPostClaim(db, swarmId, claim)) {
      insertEvent(db, swarmId, "post.claimed", { postId, claim }, now);
      return { claimed: true, claim };
    }
    const existing = findPostClaim(db, swarmId, postId, chosenRole);
    if (!existing) throw new Error("Claim conflict has no stored owner.");
    return { claimed: existing.agent === participant.name, claim: existing };
  });
}

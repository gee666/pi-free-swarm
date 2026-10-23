import type { UserPostAttention } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { userPostStates } from "../store/user-post-state.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { BrokerError } from "./errors.js";
import { setPostSubscription } from "./subscriptions.js";
import { requireSwarm } from "./validate.js";

export function getUserPostAttention(db: SwarmDb, swarmId: number, postId: number): UserPostAttention {
  requireSwarm(db, swarmId);
  if (!Number.isSafeInteger(postId) || postId < 1)
    throw new BrokerError("validation", "postId must be a positive integer.", "postId");
  const state = userPostStates(db, swarmId, [postId]).get(postId);
  if (!state) throw new BrokerError("not_found", `Post #${postId} not found.`);
  return { postId, ...state, userUnread: userUnreadSummary(db, swarmId) };
}

/** Caller owns the mutation transaction, so flags and attention share its outbox snapshot. */
export function emitUserPostAttention(db: SwarmDb, swarmId: number, postId: number, now: number): UserPostAttention {
  const state = getUserPostAttention(db, swarmId, postId);
  insertEvent(db, swarmId, "user.post.updated", state, now);
  return state;
}

export function setUserPostSubscription(
  db: SwarmDb,
  swarmId: number,
  postId: number,
  subscribed: unknown,
  now: number,
): UserPostAttention {
  if (typeof subscribed !== "boolean")
    throw new BrokerError(
      "validation",
      "subscribed must be true to follow this post or false to leave it.",
      "subscribed",
    );
  return db.write(() => {
    setPostSubscription(db, swarmId, USER_NAME, postId, subscribed, now);
    return emitUserPostAttention(db, swarmId, postId, now);
  });
}

import type { UserPostAttention } from "../../../src/api-types";
import { getJson, postJson } from "./http";

const url = (swarmId: number | string, postId: number) =>
  `/api/swarms/${encodeURIComponent(swarmId)}/posts/${postId}/subscription`;

export function fetchPostSubscription(
  swarmId: number | string,
  postId: number,
  signal: AbortSignal,
): Promise<UserPostAttention> {
  return getJson<UserPostAttention>(url(swarmId, postId), signal);
}

export function setPostSubscription(
  swarmId: number | string,
  postId: number,
  subscribed: boolean,
  signal: AbortSignal,
): Promise<UserPostAttention> {
  return postJson<UserPostAttention>(url(swarmId, postId), { subscribed }, signal);
}

import type { PostContract, PostDetailResponse } from "../../../src/api-types";
import { getJson, postJson } from "./http";

export async function fetchPostContract(swarmId: number, postId: number): Promise<PostContract | null> {
  const detail = await getJson<PostDetailResponse>(`/api/swarms/${swarmId}/posts/${postId}`);
  return detail.contract ?? null;
}

export function savePostContract(
  swarmId: number,
  postId: number,
  text: string,
  expectedRevision: number,
): Promise<{ contract: PostContract }> {
  return postJson(`/api/swarms/${swarmId}/posts/${postId}/contract`, { text, expectedRevision });
}

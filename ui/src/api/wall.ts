import type {
  CreateCommentRequest,
  CreateCommentResponse,
  CreatePostRequest,
  CreatePostResponse,
  PostDetailResponse,
  PostListQuery,
  PostListResponse,
} from "../../../src/api-types";
import { getJson, postJson } from "./http";

const postsUrl = (swarmId: number | string) => `/api/swarms/${encodeURIComponent(swarmId)}/posts`;

/** Newest first. */
export function fetchPosts(
  swarmId: number | string,
  query: PostListQuery,
  signal?: AbortSignal,
): Promise<PostListResponse> {
  const params = new URLSearchParams();
  if (query.count !== undefined) params.set("count", String(query.count));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  return getJson<PostListResponse>(`${postsUrl(swarmId)}?${params}`, signal);
}

/** The post with its comments, oldest first. */
export function fetchPost(swarmId: number | string, postId: number, signal: AbortSignal): Promise<PostDetailResponse> {
  return getJson<PostDetailResponse>(`${postsUrl(swarmId)}/${postId}`, signal);
}

export function createPost(swarmId: number | string, request: CreatePostRequest): Promise<CreatePostResponse> {
  return postJson<CreatePostResponse>(postsUrl(swarmId), request);
}

export function createComment(
  swarmId: number | string,
  postId: number,
  request: CreateCommentRequest,
): Promise<CreateCommentResponse> {
  return postJson<CreateCommentResponse>(`${postsUrl(swarmId)}/${postId}/comments`, request);
}

import type { CommentView, PostDetailResponse, PostListResponse, PostSummary } from "../../../../src/api-types";

/** Adds a post on top unless it is already listed (own POST response and its event). */
export function withPost(list: PostListResponse, post: PostSummary): PostListResponse {
  if (list.posts.some((existing) => existing.id === post.id)) return list;
  return { posts: [post, ...list.posts], total: list.total + 1 };
}

export function withCommentCount(list: PostListResponse, postId: number, commentCount: number): PostListResponse {
  const target = list.posts.find((post) => post.id === postId);
  if (!target || target.commentCount === commentCount) return list;
  return { ...list, posts: list.posts.map((post) => (post === target ? { ...post, commentCount } : post)) };
}

/** Appends an older page, skipping posts already listed because newer ones shifted the offsets. */
export function withOlderPosts(list: PostListResponse, page: PostListResponse): PostListResponse {
  const known = new Set(list.posts.map((post) => post.id));
  return { posts: [...list.posts, ...page.posts.filter((post) => !known.has(post.id))], total: page.total };
}

export function withComment(
  detail: PostDetailResponse,
  comment: CommentView,
  commentCount: number,
): PostDetailResponse {
  if (comment.postId !== detail.post.id || detail.comments.some((existing) => existing.id === comment.id)) {
    return detail;
  }
  return { post: { ...detail.post, commentCount }, comments: [...detail.comments, comment] };
}

/** "1 comment", "4 comments". */
export const commentCountLabel = (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`;

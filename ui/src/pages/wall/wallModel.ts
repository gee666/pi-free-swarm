import type { CommentView, PostDetailResponse, PostListResponse, PostSummary } from "../../../../src/api-types";
import { insertNewest, newestFirst } from "../../lib/newestFirst";

export function orderPost(detail: PostDetailResponse): PostDetailResponse {
  return { ...detail, comments: newestFirst(detail.comments) };
}

/** Own POST responses can arrive before their matching stream events. */
export function withPost(list: PostListResponse, post: PostSummary): PostListResponse {
  const posts = insertNewest(list.posts, post);
  return posts === list.posts ? list : { posts, total: list.total + 1 };
}

/** Comments are add-only; replayed events must not lower a newer snapshot's count. */
export function withCommentCount(list: PostListResponse, postId: number, commentCount: number): PostListResponse {
  const target = list.posts.find((post) => post.id === postId);
  if (!target || target.commentCount >= commentCount) return list;
  return { ...list, posts: list.posts.map((post) => (post === target ? { ...post, commentCount } : post)) };
}

/** Appends an older page, skipping posts already listed because newer ones shifted the offsets. */
export function withOlderPosts(list: PostListResponse, page: PostListResponse): PostListResponse {
  const known = new Set(list.posts.map((post) => post.id));
  return {
    posts: newestFirst([...list.posts, ...page.posts.filter((post) => !known.has(post.id))]),
    total: page.total,
  };
}

export function withComment(
  detail: PostDetailResponse,
  comment: CommentView,
  commentCount: number,
): PostDetailResponse {
  if (comment.postId !== detail.post.id || detail.comments.some((existing) => existing.id === comment.id)) {
    return detail;
  }
  return {
    post: { ...detail.post, commentCount: Math.max(detail.post.commentCount, commentCount) },
    comments: insertNewest(detail.comments, comment),
  };
}

/** "1 comment", "4 comments". */
export const commentCountLabel = (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`;

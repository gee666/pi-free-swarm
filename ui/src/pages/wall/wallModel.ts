import type {
  CommentView,
  PostDetailResponse,
  PostListResponse,
  PostSummary,
  UserPostAttention,
} from "../../../../src/api-types";
import { insertNewest, newestFirst } from "../../lib/newestFirst";

export function orderPost(detail: PostDetailResponse): PostDetailResponse {
  return { ...detail, comments: newestFirst(detail.comments) };
}

/** Own POST responses can arrive before their matching stream events. */
export function withPost(list: PostListResponse, post: PostSummary): PostListResponse {
  const posts = insertNewest(list.posts, post);
  return posts === list.posts ? list : { ...list, posts, total: list.total + 1 };
}

/** Replayed events must not lower a newer snapshot's count. */
export function withCommentCount(list: PostListResponse, postId: number, commentCount: number): PostListResponse {
  const target = list.posts.find((post) => post.id === postId);
  if (!target || target.commentCount >= commentCount) return list;
  return { ...list, posts: list.posts.map((post) => (post === target ? { ...post, commentCount } : post)) };
}

export function withOlderPosts(list: PostListResponse, page: PostListResponse): PostListResponse {
  const known = new Set(list.posts.map((post) => post.id));
  return { ...page, posts: newestFirst([...list.posts, ...page.posts.filter((post) => !known.has(post.id))]) };
}

export function withComment(
  detail: PostDetailResponse,
  comment: CommentView,
  commentCount: number,
): PostDetailResponse {
  if (comment.postId !== detail.post.id || detail.comments.some((existing) => existing.id === comment.id))
    return detail;
  return {
    ...detail,
    post: { ...detail.post, commentCount: Math.max(detail.post.commentCount, commentCount) },
    comments: insertNewest(detail.comments, comment),
  };
}

export function withUserPostAttention(post: PostSummary, attention: UserPostAttention): PostSummary {
  if (
    post.id !== attention.postId ||
    (post.userSubscribed === attention.userSubscribed && post.userUnreadComments === attention.userUnreadComments)
  )
    return post;
  return { ...post, userSubscribed: attention.userSubscribed, userUnreadComments: attention.userUnreadComments };
}

export function withUserPostListAttention(list: PostListResponse, attention: UserPostAttention): PostListResponse {
  const target = list.posts.find((post) => post.id === attention.postId);
  if (!target) return list;
  const updated = withUserPostAttention(target, attention);
  return updated === target ? list : { ...list, posts: list.posts.map((post) => (post === target ? updated : post)) };
}

export const commentCountLabel = (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`;

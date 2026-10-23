import type {
  CommentView,
  PostClaim,
  PostContract,
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

export function withPostClaim(post: PostSummary, claim: PostClaim): PostSummary {
  if (post.id !== claim.postId || post.claims?.some((existing) => existing.role === claim.role)) return post;
  return { ...post, claims: [...(post.claims ?? []), claim] };
}

export function withPostListClaim(list: PostListResponse, claim: PostClaim): PostListResponse {
  const target = list.posts.find((post) => post.id === claim.postId);
  if (!target) return list;
  const updated = withPostClaim(target, claim);
  return updated === target ? list : { ...list, posts: list.posts.map((post) => (post === target ? updated : post)) };
}

export function withContractMetadata(post: PostSummary, contract: PostContract): PostSummary {
  if (post.id !== contract.postId || (post.contract?.revision ?? 0) >= contract.revision) return post;
  return {
    ...post,
    contract: {
      postId: contract.postId,
      revision: contract.revision,
      updatedBy: contract.updatedBy,
      updatedAt: contract.updatedAt,
    },
  };
}

export function withPostContract(detail: PostDetailResponse, contract: PostContract): PostDetailResponse {
  if (detail.post.id !== contract.postId || (detail.contract?.revision ?? 0) >= contract.revision) return detail;
  return { ...detail, post: withContractMetadata(detail.post, contract), contract };
}

export function withPostListContract(list: PostListResponse, contract: PostContract): PostListResponse {
  const target = list.posts.find((post) => post.id === contract.postId);
  if (!target) return list;
  const updated = withContractMetadata(target, contract);
  return updated === target ? list : { ...list, posts: list.posts.map((post) => (post === target ? updated : post)) };
}

/** "1 comment", "4 comments". */
export const commentCountLabel = (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`;

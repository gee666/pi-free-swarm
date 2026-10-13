import { describe, expect, it } from "vitest";
import type { CommentView, PostDetailResponse, PostSummary } from "../../../../src/api-types";
import { orderPost, withComment, withOlderPosts, withPost } from "./wallModel";

const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "John",
  title: "Plan",
  text: "Body",
  createdAt: 10,
  commentCount: 2,
};
const comment = (id: number, createdAt: number): CommentView => ({
  id,
  postId: 1,
  swarmId: 3,
  author: "Maria",
  text: String(id),
  createdAt,
});
const detail: PostDetailResponse = { post, comments: [comment(1, 10), comment(2, 20)] };

describe("wall chronology", () => {
  it("normalizes API comments and inserts live or submitted comments at the correct position", () => {
    const ordered = orderPost(detail);
    expect(ordered.comments.map(({ id }) => id)).toEqual([2, 1]);
    const updated = withComment(ordered, comment(3, 15), 3);
    expect(updated.comments.map(({ id }) => id)).toEqual([2, 3, 1]);
    const latest = withComment(updated, comment(4, 30), 4);
    expect(latest.comments.map(({ id }) => id)).toEqual([4, 2, 3, 1]);
    expect(withComment(latest, comment(4, 30), 4)).toBe(latest);
    expect(detail.comments.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("keeps newer posts on top when events and older pages overlap", () => {
    const latest = { ...post, id: 3, createdAt: 30 };
    const middle = { ...post, id: 2, createdAt: 20 };
    const list = { posts: [latest, post], total: 2 };
    expect(withPost(list, middle).posts.map(({ id }) => id)).toEqual([3, 2, 1]);
    expect(withPost(list, latest)).toBe(list);
    const page = { posts: [post, middle], total: 3 };
    expect(withOlderPosts(list, page).posts.map(({ id }) => id)).toEqual([3, 2, 1]);
  });
});

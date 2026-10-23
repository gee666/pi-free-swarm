import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PostSummary, UserPostAttention } from "../../../../src/api-types";
import { useSeenComments } from "./useSeenComments";
import { withUserPostAttention, withUserPostListAttention } from "./wallModel";

const post = (id: number, userSubscribed?: boolean, userUnreadComments?: number): PostSummary => ({
  id,
  swarmId: 3,
  author: "John",
  title: `Post ${id}`,
  text: "Body",
  commentCount: 10,
  createdAt: 1,
  userSubscribed,
  userUnreadComments,
});
function Counts({ posts }: { posts: PostSummary[] }) {
  const unread = useSeenComments("3", posts, undefined);
  return (
    <>
      {posts.map((entry) => (
        <output key={entry.id} aria-label={`Post ${entry.id} unread`}>
          {unread(entry)}
        </output>
      ))}
    </>
  );
}

describe("User subscription-aware wall state", () => {
  it("shows authoritative initial unread counts only for subscribed posts without fabricating hidden reads", () => {
    const view = render(<Counts posts={[post(1, true, 3), post(2, false, 7), post(3)]} />);
    expect(screen.getByLabelText("Post 1 unread")).toHaveTextContent("3");
    expect(screen.getByLabelText("Post 2 unread")).toHaveTextContent("0");
    expect(screen.getByLabelText("Post 3 unread")).toHaveTextContent("0");
    view.rerender(<Counts posts={[post(1, false, 3), post(2, true, 7)]} />);
    expect(screen.getByLabelText("Post 1 unread")).toHaveTextContent("0");
    expect(screen.getByLabelText("Post 2 unread")).toHaveTextContent("7");
  });

  it("patches the relevant post only and preserves content/counts during snapshot replay", () => {
    const first = post(1, true, 2);
    const second = post(2, false, 0);
    const attention: UserPostAttention = {
      postId: 1,
      userSubscribed: false,
      userUnreadComments: 0,
      userUnread: { messages: 4, comments: 0 },
    };
    expect(withUserPostAttention(second, attention)).toBe(second);
    const list = withUserPostListAttention({ posts: [first, second], total: 2 }, attention);
    expect(list.posts[0]).toEqual({ ...first, userSubscribed: false, userUnreadComments: 0 });
    expect(list.posts[1]).toBe(second);
    expect(withUserPostListAttention(list, attention)).toBe(list);
    expect(withUserPostListAttention(list, { ...attention, postId: 9 })).toBe(list);
  });
});

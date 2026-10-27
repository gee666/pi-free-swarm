import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentView, PostDetailResponse, UserCommentsReadResponse } from "../../../../src/api-types";
import { PAGE_MAX_COUNT } from "../../../../src/constants";
import { StrictMode } from "react";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { useUserCommentRead } from "./useUserCommentRead";

function comment(id: number, postId = 1, author = "John"): CommentView {
  return { id, postId, swarmId: 3, author, text: `Comment ${id}`, createdAt: id };
}
function detail(comments: CommentView[], postId = 1): PostDetailResponse {
  return {
    post: {
      id: postId,
      swarmId: 3,
      author: "User",
      title: "Visible",
      text: "Body",
      commentCount: comments.length,
      createdAt: 1,
    },
    comments,
    links: [],
  };
}
function View({
  value,
  postId = 1,
  enabled = true,
}: {
  value?: PostDetailResponse;
  postId?: number;
  enabled?: boolean;
}) {
  const error = useUserCommentRead("3", postId, value, enabled);
  return (
    <article>
      {value?.comments.map((entry) => (
        <p key={entry.id}>{entry.text}</p>
      ))}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
const result = (): UserCommentsReadResponse => ({ updated: 1, userUnread: { messages: 2, comments: 0 } });
let api: FakeApi;
beforeEach(() => {
  api = installFakeApi();
  api.on("POST", "/api/swarms/3/posts/1/read", result);
  api.on("POST", "/api/swarms/3/posts/2/read", result);
});
afterEach(() => vi.restoreAllMocks());
const reads = (postId = 1) => api.callsTo("POST", `/api/swarms/3/posts/${postId}/read`);

describe("User visible comment read state", () => {
  it("does not mark a loading/mismatched post or an unsupported legacy response", async () => {
    const view = render(<View value={detail([comment(1)])} postId={2} />);
    expect(reads()).toHaveLength(0);
    view.rerender(<View value={detail([comment(1)])} enabled={false} />);
    await Promise.resolve();
    expect(reads()).toHaveLength(0);
    const foreign = detail([comment(1)]);
    foreign.post.swarmId = 4;
    view.rerender(<View value={foreign} />);
    await act(async () => Promise.resolve());
    expect(reads()).toHaveLength(0);
  });

  it("marks only rendered other-author IDs and only new IDs after a subsequent render", async () => {
    const initial = detail([comment(3, 1, "User"), comment(2), comment(1)]);
    const view = render(<View value={initial} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    expect(reads()[0].body).toEqual({ commentIds: [1, 2] });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    view.rerender(<View value={detail([comment(4), ...initial.comments])} />);
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1].body).toEqual({ commentIds: [4] });
  });

  it("skips confirmed-empty unread state and reacts when authoritative metadata changes", async () => {
    const initial = detail([comment(1)]);
    initial.post.userSubscribed = true;
    initial.post.userUnreadComments = 0;
    const view = render(<View value={initial} />);
    await act(async () => Promise.resolve());
    expect(reads()).toHaveLength(0);
    view.rerender(<View value={{ ...initial, post: { ...initial.post, userUnreadComments: 1 } }} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    expect(reads()[0].body).toEqual({ commentIds: [1] });
  });

  it("bounds batches and does not omit any rendered IDs", async () => {
    const count = PAGE_MAX_COUNT * 2 + 5;
    render(<View value={detail(Array.from({ length: count }, (_, index) => comment(count - index)))} />);
    await waitFor(() => expect(reads()).toHaveLength(3));
    expect(reads().map((call) => call.body)).toEqual([
      { commentIds: Array.from({ length: PAGE_MAX_COUNT }, (_, index) => index + 1) },
      { commentIds: Array.from({ length: PAGE_MAX_COUNT }, (_, index) => PAGE_MAX_COUNT + index + 1) },
      { commentIds: Array.from({ length: 5 }, (_, index) => PAGE_MAX_COUNT * 2 + index + 1) },
    ]);
  });

  it("drains new rendered arrivals after an in-flight read without parallel requests", async () => {
    let release: ((value: UserCommentsReadResponse) => void) | undefined;
    api.on(
      "POST",
      "/api/swarms/3/posts/1/read",
      () =>
        new Promise<UserCommentsReadResponse>((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<View value={detail([comment(1)])} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    view.rerender(<View value={detail([comment(2), comment(1)])} />);
    expect(reads()).toHaveLength(1);
    api.on("POST", "/api/swarms/3/posts/1/read", result);
    expect(release).toBeDefined();
    release?.(result());
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1].body).toEqual({ commentIds: [2] });
  });

  it("aborts an old post read and never applies its failure to the newly selected post", async () => {
    let release: ((value: Response) => void) | undefined;
    api.on(
      "POST",
      "/api/swarms/3/posts/1/read",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<View value={detail([comment(1)])} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.rerender(<View postId={2} value={detail([comment(2, 2)], 2)} />);
    await waitFor(() => expect(reads(2)).toHaveLength(1));
    expect(signal?.aborted).toBe(true);
    expect(release).toBeDefined();
    await act(async () => {
      release?.(jsonResponse(503, { message: "Old post failed" }));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recreates the request generation during StrictMode effect replay", async () => {
    const view = render(
      <StrictMode>
        <View value={detail([comment(1)])} />
      </StrictMode>,
    );
    await waitFor(() => expect(reads().length).toBeGreaterThanOrEqual(2));
    view.rerender(
      <StrictMode>
        <View value={detail([comment(2), comment(1)])} />
      </StrictMode>,
    );
    await waitFor(() => expect(reads().at(-1)?.body).toEqual({ commentIds: [2] }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts on unsubscribe, leaves hidden IDs alone and reads rendered IDs after resubscribe", async () => {
    let release: ((value: UserCommentsReadResponse) => void) | undefined;
    api.on(
      "POST",
      "/api/swarms/3/posts/1/read",
      () =>
        new Promise<UserCommentsReadResponse>((resolve) => {
          release = resolve;
        }),
    );
    const initial = detail([comment(1)]);
    initial.post.userSubscribed = true;
    const view = render(<View value={initial} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.rerender(<View value={{ ...initial, post: { ...initial.post, userSubscribed: false } }} />);
    expect(signal?.aborted).toBe(true);
    expect(release).toBeDefined();
    await act(async () => {
      release?.({ ...result(), userSubscribed: false });
    });
    expect(reads()).toHaveLength(1);
    api.on("POST", "/api/swarms/3/posts/1/read", result);
    view.rerender(<View value={initial} />);
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1].body).toEqual({ commentIds: [1] });
  });

  it("does not consume local progress when the server rejects a stale subscription snapshot", async () => {
    api.on("POST", "/api/swarms/3/posts/1/read", () => ({ ...result(), updated: 0, userSubscribed: false }));
    const initial = detail([comment(1)]);
    initial.post.userSubscribed = true;
    const view = render(<View value={initial} />);
    await waitFor(() => expect(reads()).toHaveLength(1));
    await act(async () => Promise.resolve());
    api.on("POST", "/api/swarms/3/posts/1/read", result);
    view.rerender(<View value={{ ...initial, comments: [...initial.comments] }} />);
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1].body).toEqual({ commentIds: [1] });
  });

  it("retains unread progress on failure and retries only when new content is rendered", async () => {
    api.on("POST", "/api/swarms/3/posts/1/read", () => jsonResponse(503, { message: "Read failed" }));
    const view = render(<View value={detail([comment(1)])} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Read failed");
    api.on("POST", "/api/swarms/3/posts/1/read", result);
    view.rerender(<View value={detail([comment(2), comment(1)])} />);
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(reads()[1].body).toEqual({ commentIds: [1, 2] });
  });
});

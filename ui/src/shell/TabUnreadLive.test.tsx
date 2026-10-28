import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { PostSummary, SwarmEvent, UserCommentsReadResponse } from "../../../src/api-types";
import { SwarmViewProvider } from "../api/SwarmView";
import { installFakeApi } from "../test/fakeApi";
import { installFakeEventSource } from "../test/fakeEventSource";
import { detail, eventBase } from "../pages/agents/testFixtures";
import { useSwarmDetail } from "../pages/agents/useSwarmDetail";
import { WallPage } from "../pages/wall/WallPage";
import { TabRail } from "./TabRail";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Badges() {
  const current = useSwarmDetail("3");
  return <TabRail basePath="/s/3" unread={current.data?.userUnread} />;
}

it("patches live badge totals without refetches and clears only the rendered post's comment IDs", async () => {
  const api = installFakeApi();
  const source = installFakeEventSource();
  const snapshot = detail();
  snapshot.userUnread = { messages: 0, comments: 2 };
  snapshot.participants = snapshot.participants.map((entry) =>
    entry.kind === "user" ? { ...entry, unread: 3 } : entry,
  );
  api.on("GET", "/api/swarms/3", () => snapshot);
  const post: PostSummary = {
    id: 1,
    swarmId: 3,
    author: "User",
    title: "Read this post",
    text: "Visible post",
    commentCount: 2,
    createdAt: 1,
    userSubscribed: true,
    userUnreadComments: 2,
  };
  api.on("GET", "/api/swarms/3/posts", () => ({
    posts: [post, { ...post, id: 2, title: "Still unopened", commentCount: 0, userUnreadComments: 0 }],
    total: 2,
  }));
  api.on("GET", "/api/swarms/3/posts/1", () => ({
    post,
    comments: [
      { id: 10, postId: 1, swarmId: 3, author: "John", text: "First visible comment", createdAt: 1 },
      { id: 11, postId: 1, swarmId: 3, author: "Emma", text: "Second visible comment", createdAt: 2 },
    ],
  }));
  let release: ((value: UserCommentsReadResponse) => void) | undefined;
  api.on(
    "POST",
    "/api/swarms/3/posts/1/read",
    () =>
      new Promise<UserCommentsReadResponse>((resolve) => {
        release = resolve;
      }),
  );
  render(
    <MemoryRouter initialEntries={["/s/3/wall/1"]}>
      <SwarmViewProvider swarmId="3">
        <Badges />
        <Routes>
          <Route path="/s/:id/wall/:postId?" element={<WallPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
  expect(await screen.findByRole("link", { name: "Wall 2 unread updates" })).toBeInTheDocument();
  expect(await screen.findByText("First visible comment")).toBeInTheDocument();
  await waitFor(() => expect(api.callsTo("POST", "/api/swarms/3/posts/1/read")).toHaveLength(1));
  expect(api.callsTo("POST", "/api/swarms/3/posts/1/read")[0].body).toEqual({ commentIds: [10, 11] });
  const emit = (event: SwarmEvent) => act(() => source().emit(event));
  emit({
    ...eventBase,
    type: "user.post.updated",
    payload: {
      postId: 1,
      userSubscribed: true,
      userUnreadComments: 0,
      userUnread: { messages: 0, comments: 0 },
    },
  });
  expect(screen.getByRole("link", { name: "Wall" })).toBeInTheDocument();
  emit({
    ...eventBase,
    type: "comment.created",
    payload: {
      comment: { id: 12, postId: 2, swarmId: 3, author: "John", text: "Unopened comment", createdAt: 3 },
      commentCount: 1,
    },
  });
  emit({
    ...eventBase,
    type: "user.post.updated",
    payload: {
      postId: 2,
      userSubscribed: false,
      userUnreadComments: 1,
      userUnread: { messages: 0, comments: 1 },
    },
  });
  expect(release).toBeDefined();
  await act(async () => {
    release?.({ updated: 2, userUnread: { messages: 0, comments: 0 } });
  });
  expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wall 1 unread updates" })).toBeInTheDocument();
  expect(api.callsTo("POST", "/api/swarms/3/posts/2/read")).toHaveLength(0);
  expect(api.callsTo("GET", "/api/swarms/3")).toHaveLength(1);
});

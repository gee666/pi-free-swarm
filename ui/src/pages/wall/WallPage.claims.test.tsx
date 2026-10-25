import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PostClaim, PostSummary } from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { detail, eventBase } from "../agents/testFixtures";
import { withPostClaim, withPostListClaim } from "./wallModel";
import { WallPage } from "./WallPage";

const claim: PostClaim = { postId: 1, role: "literature review", agent: "Maria", createdAt: 2 };
const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "User",
  title: "Research discussion",
  text: "Review the evidence.",
  commentCount: 0,
  createdAt: 1,
};
let api: FakeApi;
let source: () => FakeEventSource;

beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
  api.on("GET", "/api/swarms/3", () => detail());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderWall(claims: PostClaim[] = []) {
  const snapshot = { ...post, claims };
  api.on("GET", "/api/swarms/3/posts", () => ({ posts: [snapshot], total: 1 }));
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post: snapshot, comments: [] }));
  render(
    <MemoryRouter initialEntries={["/s/3/wall/1"]}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/wall/:postId?" element={<WallPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
  await within(screen.getByRole("region", { name: "Post" })).findByText(post.text);
}

it("shows chosen free-text roles and their owners from a post snapshot", async () => {
  await renderWall([claim, { ...claim, role: "field observations", agent: "John" }]);
  const claims = screen.getByRole("region", { name: "Claimed roles" });
  expect(within(claims).getByText("literature review")).toBeInTheDocument();
  expect(within(claims).getByText("Maria")).toBeInTheDocument();
  expect(within(claims).getByText("field observations")).toBeInTheDocument();
  expect(within(claims).getByText("John")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Wall" })).getByText("2 claims")).toBeInTheDocument();
});

it("adds live claims to the list and open post once without refetching or a comment", async () => {
  await renderWall();
  expect(screen.queryByRole("region", { name: "Claimed roles" })).not.toBeInTheDocument();
  const requests = api.callsTo("GET", "/api/swarms/3/posts/1").length;
  const event = { ...eventBase, type: "post.claimed", payload: { postId: 1, claim } } as const;
  act(() => {
    source().emit(event);
    source().emit(event);
  });
  expect(within(screen.getByRole("region", { name: "Claimed roles" })).getAllByRole("listitem")).toHaveLength(1);
  expect(within(screen.getByRole("region", { name: "Wall" })).getByText("1 claim")).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/posts/1")).toHaveLength(requests);
  expect(screen.getByRole("heading", { name: "0 comments" })).toBeInTheDocument();
});

it("ignores unrelated or repeated claims but preserves distinct exact roles", () => {
  expect(withPostClaim(post, { ...claim, postId: 2 })).toBe(post);
  const claimed = withPostClaim(post, claim);
  expect(withPostClaim(claimed, claim)).toBe(claimed);
  expect(withPostClaim(claimed, { ...claim, role: "Literature review" }).claims).toHaveLength(2);
  const list = { posts: [post], total: 1 };
  expect(withPostListClaim(list, { ...claim, postId: 2 })).toBe(list);
  expect(withPostListClaim(list, claim).posts[0].claims).toEqual([claim]);
});

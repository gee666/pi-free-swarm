import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PostContract, PostDetailResponse, PostSummary } from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { detail, eventBase } from "../agents/testFixtures";
import { withComment, withPostContract, withPostListContract } from "./wallModel";
import { WallPage } from "./WallPage";

const contract: PostContract = {
  postId: 1,
  revision: 1,
  text: "# Scope\n\nUse API output.",
  updatedBy: "Maria",
  updatedAt: 2,
};
const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "User",
  title: "Contract discussion",
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

async function renderWall(document: PostContract | null = null) {
  const snapshot = withPostListContract({ posts: [post], total: 1 }, document ?? { ...contract, postId: 2 });
  api.on("GET", "/api/swarms/3/posts", () => snapshot);
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post: snapshot.posts[0], comments: [], contract: document }));
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

it("renders the optional contract and revision without requiring one on ordinary posts", async () => {
  await renderWall();
  expect(screen.queryByRole("region", { name: "Post contract" })).not.toBeInTheDocument();
  act(() => source().emit({ ...eventBase, type: "post.contract.updated", payload: { postId: 1, contract } }));
  const document = screen.getByRole("region", { name: "Post contract" });
  expect(within(document).getByText(/# Scope/)).toHaveTextContent("Use API output.");
  expect(within(document).getByText("Revision 1 · Maria")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Wall" })).getByText("Contract r1")).toBeInTheDocument();
});

it("updates the contract live, ignores older revisions and preserves it when a comment arrives", async () => {
  await renderWall(contract);
  const updated = { ...contract, revision: 2, text: "Latest agreed contract", updatedBy: "John" };
  act(() => {
    source().emit({ ...eventBase, type: "post.contract.updated", payload: { postId: 1, contract: updated } });
    source().emit({ ...eventBase, type: "post.contract.updated", payload: { postId: 1, contract } });
    source().emit({
      ...eventBase,
      type: "post.contract.updated",
      payload: { postId: 2, contract: { ...updated, postId: 2, revision: 3 } },
    });
    source().emit({
      ...eventBase,
      type: "comment.created",
      payload: {
        comment: { id: 1, postId: 1, swarmId: 3, author: "John", text: "Evidence", createdAt: 3 },
        commentCount: 1,
      },
    });
  });
  expect(within(screen.getByRole("region", { name: "Post contract" })).getByText(updated.text)).toBeInTheDocument();
  expect(screen.getByText("Revision 2 · John")).toBeInTheDocument();
  expect(screen.getByText("Contract r2")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1 comment" })).toBeInTheDocument();
});

it("saves User edits with the displayed revision and updates without waiting for SSE", async () => {
  const saved = { ...contract, revision: 2, text: "Updated User contract", updatedBy: "User" };
  api.on("POST", "/api/swarms/3/posts/1/contract", () => ({ contract: saved }));
  await renderWall(contract);
  await userEvent.click(screen.getByRole("button", { name: "Edit contract" }));
  const editor = screen.getByRole("textbox", { name: "Contract text" });
  await userEvent.clear(editor);
  await userEvent.type(editor, saved.text);
  await userEvent.click(screen.getByRole("button", { name: "Save contract" }));
  await screen.findByText(saved.text);
  expect(api.callsTo("POST", "/api/swarms/3/posts/1/contract")[0].body).toEqual({
    text: saved.text,
    expectedRevision: 1,
  });
  expect(screen.queryByRole("textbox", { name: "Contract text" })).not.toBeInTheDocument();
  expect(screen.getByText("Contract r2")).toBeInTheDocument();
});

it("fetches the latest revision on conflict without SSE and preserves the draft for explicit merging", async () => {
  api.on("POST", "/api/swarms/3/posts/1/contract", () =>
    jsonResponse(409, { error: "validation", message: "Contract changed; reread and merge." }),
  );
  await renderWall(contract);
  await userEvent.click(screen.getByRole("button", { name: "Edit contract" }));
  const editor = screen.getByRole("textbox", { name: "Contract text" });
  await userEvent.clear(editor);
  await userEvent.type(editor, "My unsaved draft");
  const latest = { ...contract, revision: 2, text: "Concurrent winner", updatedBy: "John" };
  const requestsBefore = api.callsTo("GET", "/api/swarms/3/posts/1").length;
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post, comments: [], contract: latest }));
  await userEvent.click(screen.getByRole("button", { name: "Save contract" }));
  await screen.findByText("Contract changed; reread and merge.");
  expect(editor).toHaveValue("My unsaved draft");
  expect(api.callsTo("GET", "/api/swarms/3/posts/1")).toHaveLength(requestsBefore + 1);
  expect(screen.getByText("Concurrent winner")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save contract" })).toBeDisabled();
  await userEvent.clear(editor);
  await userEvent.type(editor, "Merged contract");
  await userEvent.click(screen.getByRole("button", { name: "I've merged revision 2" }));
  api.on("POST", "/api/swarms/3/posts/1/contract", () => ({
    contract: { ...latest, revision: 3, text: "Merged contract", updatedBy: "User" },
  }));
  await userEvent.click(screen.getByRole("button", { name: "Save contract" }));
  await screen.findByText("Revision 3 · User");
  expect(api.callsTo("POST", "/api/swarms/3/posts/1/contract")[1].body).toEqual({
    text: "Merged contract",
    expectedRevision: 2,
  });
});

it("cancels edits without mutating the contract", async () => {
  await renderWall(contract);
  await userEvent.click(screen.getByRole("button", { name: "Edit contract" }));
  await userEvent.clear(screen.getByRole("textbox", { name: "Contract text" }));
  await userEvent.click(
    within(screen.getByRole("region", { name: "Post contract" })).getByRole("button", { name: "Cancel" }),
  );
  expect(screen.queryByRole("textbox", { name: "Contract text" })).not.toBeInTheDocument();
  expect(api.callsTo("POST", "/api/swarms/3/posts/1/contract")).toHaveLength(0);
});

it("keeps bodies out of list metadata and rejects stale or unrelated reducer updates", () => {
  const list = withPostListContract({ posts: [post], total: 1 }, contract);
  expect(list.posts[0].contract).not.toHaveProperty("text");
  expect(withPostListContract(list, contract)).toBe(list);
  const initial: PostDetailResponse = { post: list.posts[0], comments: [], contract };
  expect(withPostContract(initial, contract)).toBe(initial);
  expect(withPostContract(initial, { ...contract, postId: 2 })).toBe(initial);
  const commented = withComment(
    initial,
    { id: 1, postId: 1, swarmId: 3, author: "John", text: "Evidence", createdAt: 3 },
    1,
  );
  expect(commented.contract).toBe(contract);
});

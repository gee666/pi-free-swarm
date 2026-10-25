import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PostSummary } from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { detail } from "../agents/testFixtures";
import { WallPage } from "./WallPage";

const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "User",
  title: "Draft discussion",
  text: "body",
  commentCount: 0,
  createdAt: 1,
};

let api: FakeApi;

beforeEach(() => {
  api = installFakeApi();
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/3/posts", () => ({
    posts: [post, { ...post, id: 2, title: "Second discussion" }],
    total: 2,
  }));
  for (const id of [1, 2]) api.on("GET", `/api/swarms/3/posts/${id}`, () => ({ post: { ...post, id }, comments: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(path: string) {
  const source = installFakeEventSource();
  render(
    <MemoryRouter initialEntries={[path]}>
      <SwarmViewProvider swarmId="3">
        <nav>
          <Link to="/s/3/stats">Stats tab</Link>
          <Link to="/s/3/wall/new">New post tab</Link>
          <Link to="/s/3/wall/1">First post tab</Link>
          <Link to="/s/3/wall/2">Second post tab</Link>
        </nav>
        <Routes>
          <Route path="/s/:id/wall/:postId?" element={<WallPage />} />
          <Route path="/s/:id/stats" element={<p>Stats content</p>} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
  await screen.findAllByText("Draft discussion");
}

it("keeps a new post title/body across tab unmounts and explicitly discards it on Cancel", async () => {
  await mount("/s/3/wall/new");
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Unsent title");
  await user.type(screen.getByRole("textbox", { name: "Body" }), "Unsent body @John");
  await user.click(screen.getByRole("link", { name: "Stats tab" }));
  expect(screen.queryByRole("textbox", { name: "Body" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "New post tab" }));
  expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Unsent title");
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveValue("Unsent body @John");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("link", { name: "New post tab" }));
  expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveValue("");
});

it("clears a successfully published new post draft", async () => {
  api.on("POST", "/api/swarms/3/posts", () => ({ post }));
  await mount("/s/3/wall/new");
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Published title");
  await user.type(screen.getByRole("textbox", { name: "Body" }), "Published body");
  await user.click(screen.getByRole("button", { name: "Post" }));
  await screen.findByRole("textbox", { name: "Write a comment…" });
  await user.click(screen.getByRole("link", { name: "New post tab" }));
  expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveValue("");
});

it("keeps independent comment drafts across tabs and between posts", async () => {
  await mount("/s/3/wall/1");
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Write a comment…" }), "First draft");
  await user.click(screen.getByRole("link", { name: "Second post tab" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Write a comment…" })).toHaveValue(""));
  await user.type(screen.getByRole("textbox", { name: "Write a comment…" }), "Second draft");
  await user.click(screen.getByRole("link", { name: "Stats tab" }));
  await user.click(screen.getByRole("link", { name: "First post tab" }));
  expect(await screen.findByRole("textbox", { name: "Write a comment…" })).toHaveValue("First draft");
  await user.click(screen.getByRole("link", { name: "Second post tab" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Write a comment…" })).toHaveValue("Second draft"));
});

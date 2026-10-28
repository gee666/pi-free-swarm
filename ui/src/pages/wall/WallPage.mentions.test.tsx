import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostSummary } from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { agent, detail } from "../agents/testFixtures";
import { WallPage } from "./WallPage";

const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "User",
  title: "Mention discussion",
  text: "Please review this.",
  commentCount: 0,
  createdAt: 1,
};

let api: FakeApi;
let openEvents: () => void;

beforeEach(() => {
  api = installFakeApi();
  const source = installFakeEventSource();
  openEvents = () => source().open();
  api.on("GET", "/api/swarms/3", () => {
    const snapshot = detail();
    snapshot.participants.push(agent("Watcher", 4));
    return snapshot;
  });
  api.on("GET", "/api/swarms/3/posts", () => ({ posts: [post], total: 1 }));
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post, comments: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderWall(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/wall/:postId?" element={<WallPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(openEvents);
  await within(screen.getByRole("region", { name: "Wall" })).findByText("Mention discussion");
}

describe("wall mention integration", () => {
  it("broadcasts only when the User opts in and displays pills in the list and detail", async () => {
    const published = { ...post, id: 2, title: "Announcement", broadcast: true };
    api.on("POST", "/api/swarms/3/posts", () => ({ post: published }));
    api.on("GET", "/api/swarms/3/posts/2", () => ({ post: published, comments: [] }));
    await renderWall("/s/3/wall/new");
    const user = userEvent.setup();
    const toggle = screen.getByRole("checkbox", { name: "Broadcast to all agents" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Every agent is notified once.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Announcement");
    await user.type(screen.getByRole("textbox", { name: "Body" }), "Read this");
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/posts")[0]?.body).toEqual({
        title: "Announcement",
        text: "Read this",
        broadcast: true,
      }),
    );
    await waitFor(() => expect(screen.getAllByText("Broadcast")).toHaveLength(2));
  });

  it("offers User and Watcher mentions and highlights known names in posts and comments", async () => {
    api.on("GET", "/api/swarms/3/posts/1", () => ({
      post: { ...post, text: "@John and @Nobody" },
      comments: [{ id: 1, postId: 1, swarmId: 3, author: "John", text: "@Maria @User", createdAt: 2 }],
    }));
    await renderWall("/s/3/wall/1");
    await waitFor(() => expect(screen.getByText("@John")).toHaveClass(/mention/));
    expect(screen.getByText("@Maria")).toHaveClass(/mention/);
    expect(screen.getByText("@User")).toHaveClass(/mention/);
    expect(screen.queryByText("@Nobody", { selector: "span" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    const box = screen.getByRole("textbox", { name: "Write a comment…" });
    await user.type(box, "@wa");
    await user.click(await screen.findByRole("option", { name: /Watcher/ }));
    expect(box).toHaveValue("@Watcher ");
  });

  it("submits the selected agent mention in a new post body", async () => {
    api.on("POST", "/api/swarms/3/posts", () => ({ post: { ...post, id: 2, title: "Review" } }));
    api.on("GET", "/api/swarms/3/posts/2", () => ({ post: { ...post, id: 2, title: "Review" }, comments: [] }));
    await renderWall("/s/3/wall/new");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Review");
    const body = screen.getByRole("textbox", { name: "Body" });
    await user.type(body, "Please @jo");
    await user.click(await screen.findByRole("option", { name: /John/ }));
    await user.type(body, "review");
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/posts")[0]?.body).toEqual({
        title: "Review",
        text: "Please @John review",
      }),
    );
  });

  it("submits a keyboard-selected mention in a comment without a subscription request", async () => {
    api.on("POST", "/api/swarms/3/posts/1/comments", () => ({
      comment: { id: 1, postId: 1, swarmId: 3, author: "User", text: "Thanks @Maria", createdAt: 2 },
      commentCount: 1,
    }));
    await renderWall("/s/3/wall/1");
    const user = userEvent.setup();
    const box = await screen.findByRole("textbox", { name: "Write a comment…" });
    await user.type(box, "Thanks @ma");
    await screen.findByRole("option", { name: /Maria/ });
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/posts/1/comments")[0]?.body).toEqual({ text: "Thanks @Maria " }),
    );
    expect(api.callsTo("POST", "/api/swarms/3/posts/1/subscription")).toHaveLength(0);
  });
});

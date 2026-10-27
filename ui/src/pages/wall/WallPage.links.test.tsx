import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostLinkView, PostSummary } from "../../../../src/api-types";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { eventBase } from "../agents/testFixtures";
import { page, renderWork, workApi } from "../work-items/testFixtures";
import { WallPage } from "./WallPage";

const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "Ann",
  title: "Ranking discussion",
  text: "Discuss the ranking",
  createdAt: 1,
  commentCount: 0,
};
const linked: PostLinkView = {
  postId: 1,
  targetKind: "task",
  targetId: 34,
  title: "Add ranking index",
  status: "review",
  linkedBy: "Ann",
  linkedAt: 1,
};
let api: FakeApi;
let source: () => FakeEventSource;
beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
  workApi(api);
  api.on("GET", "/api/swarms/3/posts", () => ({ ...page([post]), posts: [post], total: 1 }));
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post, comments: [], links: [] }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = (path = "/s/3/wall/1") => renderWork(path, "/s/:id/wall/:postId?", <WallPage />, source);

describe("Wall work links and search", () => {
  it("accepts discussion links from navigation state and resolves their title and status", async () => {
    renderWork("/s/3/wall/new", "/s/:id/wall/:postId?", <WallPage />, source, { criterionId: 12 });
    const form = screen.getByRole("region", { name: "New post" });
    const link = within(form).getByRole("link", { name: "#12" });
    await waitFor(() => expect(within(form).getByRole("img", { name: "Incomplete" })).toBeInTheDocument());
    await userEvent.hover(link.parentElement ?? link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rank matches");
  });
  it("prefills discussion links and creates them atomically with the new post", async () => {
    api.on("POST", "/api/swarms/3/posts", () => ({ post, links: [linked] }));
    open("/s/3/wall/new?task=34");
    const form = screen.getByRole("region", { name: "New post" });
    expect(within(form).getByRole("link", { name: "#34" })).toHaveAttribute("href", "/s/3/tasks/34");
    expect(screen.getByRole("button", { name: "Remove Linked to task #34" })).toBeInTheDocument();
    await userEvent.type(within(form).getByRole("textbox", { name: "Title" }), "Discuss ranking");
    await userEvent.type(within(form).getByRole("textbox", { name: "Body" }), "Please review");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/posts")[0]?.body).toEqual({
        title: "Discuss ranking",
        text: "Please review",
        taskIds: [34],
        criterionIds: [],
      }),
    );
  });
  it("links and unlinks work with status glyphs and title tooltips", async () => {
    api.on("POST", "/api/swarms/3/posts/1/link", () => ({ id: 1, links: [linked] }));
    api.on("POST", "/api/swarms/3/posts/1/unlink", () => ({ id: 1, links: [] }));
    open();
    await screen.findByRole("heading", { name: post.title });
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await userEvent.click(await screen.findByRole("option", { name: "Task #34 Add ranking index" }));
    const link = await screen.findByRole("link", { name: "#34" });
    expect(api.callsTo("POST", "/api/swarms/3/posts/1/link")[0]?.body).toEqual({ taskIds: [34], criterionIds: [] });
    expect(screen.getByRole("img", { name: "In review" })).toBeInTheDocument();
    await userEvent.hover(link.parentElement ?? link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add ranking index");
    await userEvent.unhover(link.parentElement ?? link);
    await userEvent.click(screen.getByRole("button", { name: "Unlink task #34" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "#34" })).not.toBeInTheDocument());
    expect(api.callsTo("POST", "/api/swarms/3/posts/1/unlink")[0]?.body).toEqual({ taskIds: [34], criterionIds: [] });
  });
  it("debounces searches, keeps ranked results and applies author and linked filters", async () => {
    const second = { ...post, id: 2, title: "Highest ranked", createdAt: 0 };
    api.on("GET", "/api/swarms/3/posts", ({ query }) => ({
      ...page(query.get("query") ? [second, post] : [post]),
      posts: query.get("query") ? [second, post] : [post],
      total: query.get("query") ? 2 : 1,
    }));
    open("/s/3/wall?criterion=12");
    await screen.findByText(post.title);
    expect(screen.getByRole("heading", { name: "Wall" })).toBeInTheDocument();
    expect(api.callsTo("GET", "/api/swarms/3/posts").at(-1)?.query.get("criterionId")).toBe("12");
    await userEvent.type(screen.getByRole("textbox", { name: "Search posts" }), "ranking");
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/posts").at(-1)?.query.get("query")).toBe("ranking"));
    await screen.findByText("Highest ranked");
    const rows = screen.getByRole("region", { name: "Wall" }).querySelectorAll("[data-agent-row]");
    expect(rows[0]).toHaveTextContent("Highest ranked");
    await userEvent.click(screen.getByRole("button", { name: "Author" }));
    await userEvent.click(screen.getByRole("option", { name: "Me" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/posts").at(-1)?.query.get("author")).toBe("User"));
    await userEvent.click(screen.getByRole("button", { name: "Remove Linked to criterion #12" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/posts").at(-1)?.query.has("criterionId")).toBe(false));
  });
  it("refetches an active search when new comments change its matches", async () => {
    let matches = false;
    api.on("GET", "/api/swarms/3/posts", () => ({
      ...page(matches ? [post] : []),
      posts: matches ? [post] : [],
      total: matches ? 1 : 0,
    }));
    open("/s/3/wall");
    await userEvent.type(screen.getByRole("textbox", { name: "Search posts" }), "ranking");
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/posts").at(-1)?.query.get("query")).toBe("ranking"));
    const before = api.callsTo("GET", "/api/swarms/3/posts").length;
    matches = true;
    act(() => {
      for (let i = 0; i < 3; i++)
        source().emit({
          ...eventBase,
          type: "comment.created",
          payload: {
            comment: { id: 2, postId: 1, swarmId: 3, author: "Ann", text: "ranking", createdAt: 2 },
            commentCount: 1,
          },
        });
    });
    expect(api.callsTo("GET", "/api/swarms/3/posts")).toHaveLength(before);
    expect(await screen.findByText(post.title)).toBeInTheDocument();
    expect(api.callsTo("GET", "/api/swarms/3/posts")).toHaveLength(before + 1);
  });
  it("refreshes linked post details after a debounced link event", async () => {
    open();
    await screen.findByRole("heading", { name: post.title });
    api.on("GET", "/api/swarms/3/posts/1", () => ({ post, comments: [], links: [linked] }));
    const before = api.callsTo("GET", "/api/swarms/3/posts/1").length;
    act(() => {
      source().emit({ ...eventBase, type: "post.links.changed", payload: { id: 1 } });
      source().emit({ ...eventBase, type: "post.links.changed", payload: { id: 1 } });
    });
    expect(await screen.findByRole("link", { name: "#34" })).toBeInTheDocument();
    expect(api.callsTo("GET", "/api/swarms/3/posts/1")).toHaveLength(before + 1);
  });
});

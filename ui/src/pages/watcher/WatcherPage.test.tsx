import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import type { PostDetailResponse, WatcherChatResponse } from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { agent, detail, eventBase } from "../agents/testFixtures";
import { WatcherPage } from "./WatcherPage";

const conversation: PostDetailResponse = {
  post: {
    id: 7,
    swarmId: 3,
    author: "User",
    title: "Watcher chat",
    text: "@Watcher\nStatus?",
    createdAt: 1,
    commentCount: 0,
    userUnreadComments: 0,
  },
  comments: [],
  links: [],
};
let api: FakeApi;
let source: () => FakeEventSource;
let response: WatcherChatResponse;
beforeEach(() => {
  source = installFakeEventSource();
  api = installFakeApi();
  response = { conversation: null };
  const snapshot = detail();
  snapshot.participants.push(agent("Watcher", 4, { activity: { kind: "thinking" } }));
  api.on("GET", "/api/swarms/3", () => snapshot);
  api.on("GET", "/api/swarms/3/watcher", () => response);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <MemoryRouter initialEntries={["/s/3/watcher"]}>
      <Routes>
        <Route
          path="/s/:id/watcher"
          element={
            <SwarmViewProvider swarmId="3">
              <WatcherPage />
            </SwarmViewProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  act(() => source().open());
}

it("sends without a manual mention and displays live replies and the saved conversation", async () => {
  api.on("POST", "/api/swarms/3/watcher", () => {
    response = { conversation };
    return response;
  });
  mount();
  expect(await screen.findByRole("status")).toHaveTextContent("Watcher: working");
  expect(await screen.findByText("Ask Watcher about the swarm.")).toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "Status?");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(input).toHaveValue(""));
  expect(api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({ text: "Status?" });
  const messages = screen.getByRole("list", { name: "Watcher conversation" });
  expect(await within(messages).findByText(/Status\?/)).toBeInTheDocument();
  act(() =>
    source().emit({
      ...eventBase,
      type: "comment.created",
      payload: {
        comment: { id: 9, swarmId: 3, postId: 7, author: "Watcher", text: "Three tasks remain.", createdAt: 2 },
        commentCount: 1,
      },
    }),
  );
  expect(await within(messages).findByText("Three tasks remain.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open conversation on the Wall" })).toHaveAttribute("href", "/s/3/wall/7");
});

it.each(["stopped", "finished"] as const)(
  "keeps the composer enabled for a %s swarm and explains that input is saved",
  async (status) => {
    const snapshot = detail({ status, acceptsMessages: false });
    api.on("GET", "/api/swarms/3", () => snapshot);
    mount();
    expect(
      await screen.findByText("Messages are saved, not delivered yet. Watcher can answer after the swarm resumes."),
    ).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message Watcher" });
    expect(input).toBeEnabled();
    await userEvent.type(input, "Question for later");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  },
);

it("preserves text after a failed send and reloads history after reconnect", async () => {
  api.on("POST", "/api/swarms/3/watcher", () => jsonResponse(500, { error: "internal", message: "Unavailable" }));
  mount();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "Keep this draft");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(input).toHaveValue("Keep this draft");
  response = { conversation };
  act(() => source().open());
  expect(await screen.findByText(/Status\?/)).toBeInTheDocument();
  expect(input).toHaveValue("Keep this draft");
});

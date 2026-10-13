import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WATCHER_NAME } from "../../../../src/constants";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { TabRail } from "../../shell/TabRail";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { agent, detail, eventBase, message, thread } from "../agents/testFixtures";
import { WatcherPage } from "./WatcherPage";

let api: FakeApi;
let source: () => FakeEventSource;
beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function serve(running = true, busy = false) {
  api.on("GET", "/api/swarms/3", () => {
    const record = detail({ status: running ? "running" : "finished", acceptsMessages: running });
    return {
      ...record,
      participants: [...record.participants, agent(WATCHER_NAME, 4, { status: busy ? "working" : "idle" })],
    };
  });
  const older = message(9, "User", [[WATCHER_NAME, "read"]], "Old question", { id: 100 });
  const newer = message(9, WATCHER_NAME, [["User", "delivered"]], "Newest answer", { id: 101 });
  api.on("GET", "/api/swarms/3/watcher", () => ({
    thread: thread(9, ["User", WATCHER_NAME]),
    messages: [older, newer],
  }));
  api.on("POST", "/api/swarms/3/participants/User/read", () => ({ updated: 1, unread: 0 }));
  api.on("POST", "/api/swarms/3/watcher", () => ({ message: older }));
}

function mount() {
  render(
    <MemoryRouter initialEntries={["/s/3/watcher"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SwarmStreamProvider swarmId="3">
        <TabRail basePath="/s/3" />
        <Routes>
          <Route path="/s/:id/watcher" element={<WatcherPage />} />
        </Routes>
      </SwarmStreamProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
}

it("registers the tab, puts compose above newest-first messages, shows busy state and sends through the chat API", async () => {
  serve(true, true);
  mount();
  expect(screen.getByRole("link", { name: WATCHER_NAME })).toHaveAttribute("href", "/s/3/watcher");
  const messages = await screen.findByRole("list", { name: "Messages, newest first" });
  await screen.findByText("Newest answer");
  const entries = within(messages).getAllByRole("listitem");
  expect(entries[0]).toHaveTextContent("Newest answer");
  expect(entries[1]).toHaveTextContent("Old question");
  const composer = screen.getByRole("textbox", { name: "Ask Watcher about the swarm…" });
  expect(composer.compareDocumentPosition(messages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("status")).toHaveTextContent("Watcher is answering");
  const user = userEvent.setup();
  await user.type(composer, "What is Maria doing?");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({ text: "What is Maria doing?" }),
  );
  await waitFor(() => expect(composer).toHaveValue(""));
  expect(api.callsTo("POST", "/api/swarms/3/participants/User/read")[0]?.body).toEqual({ messageIds: [101] });
});

it("keeps compose enabled after finish, explains availability, queues questions and reloads on new messages", async () => {
  serve(false);
  mount();
  const composer = await screen.findByRole("textbox", { name: "Ask Watcher about the swarm…" });
  await screen.findByText("Newest answer");
  expect(screen.getByText(/Watcher is available while the swarm runs/)).toBeInTheDocument();
  expect(composer).toBeEnabled();
  const user = userEvent.setup();
  await user.type(composer, "What did they finish?");
  await user.click(screen.getByRole("button", { name: "Queue question" }));
  await waitFor(() => expect(api.callsTo("POST", "/api/swarms/3/watcher")).toHaveLength(1));
  const before = api.callsTo("GET", "/api/swarms/3/watcher").length;
  act(() =>
    source().emit({
      ...eventBase,
      type: "message.created",
      payload: { message: message(9, WATCHER_NAME, [["User", "delivered"]], "New update"), unread: { User: 1 } },
    }),
  );
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/watcher").length).toBeGreaterThan(before));
});

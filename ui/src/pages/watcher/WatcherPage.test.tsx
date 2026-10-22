import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const newer = message(9, WATCHER_NAME, [["User", "delivered"]], "**Newest answer**", { id: 101 });
  const messages = [newer, older];
  api.on("GET", "/api/swarms/3/watcher", () => ({
    thread: thread(9, ["User", WATCHER_NAME]),
    messages,
  }));
  api.on("POST", "/api/swarms/3/participants/User/read", () => ({ updated: 1, unread: 0 }));
  api.on("POST", "/api/swarms/3/watcher", () => ({ message: older }));
  return messages;
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

it("pins compose below oldest-first messages and keeps activity outside scrolling history", async () => {
  serve(true, true);
  mount();
  expect(screen.getByRole("link", { name: WATCHER_NAME })).toHaveAttribute("href", "/s/3/watcher");
  const messages = await screen.findByRole("list", { name: "Messages, oldest first" });
  await screen.findByText("Newest answer");
  const entries = within(messages)
    .getAllByRole("listitem")
    .filter((entry) => entry.getAttribute("role") !== "status");
  expect(entries[0]).toHaveTextContent("Old question");
  expect(entries[1]).toHaveTextContent("Newest answer");
  expect(screen.getByText("Newest answer").tagName).toBe("STRONG");
  expect(entries[0].className).toMatch(/userMessage/);
  expect(entries[1].className).not.toMatch(/userMessage/);
  expect(within(messages).queryByText(/Read|Delivered/)).not.toBeInTheDocument();
  const composer = screen.getByRole("textbox", { name: "Ask about the swarm…" });
  expect(messages.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("status")).toHaveTextContent("Watcher: working…");
  expect(within(messages).queryByRole("status")).not.toBeInTheDocument();
  expect(messages.compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const user = userEvent.setup();
  await user.type(composer, "What is Maria doing?");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({ text: "What is Maria doing?" }),
  );
  await waitFor(() => expect(composer).toHaveValue(""));
  expect(api.callsTo("POST", "/api/swarms/3/participants/User/read")[0]?.body).toEqual({ messageIds: [101] });
});

it("opens at the bottom, follows new replies, and preserves the position while reading older messages", async () => {
  let height = 600;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  const history = serve();
  mount();
  await screen.findByText("Newest answer");
  const list = screen.getByRole("list", { name: "Messages, oldest first" });
  expect(list.scrollTop).toBe(600);

  async function reply(id: number) {
    const update = message(9, WATCHER_NAME, [["User", "delivered"]], `Reply ${id}`, { id });
    history.push(update);
    act(() =>
      source().emit({ ...eventBase, type: "message.created", payload: { message: update, unread: { User: 1 } } }),
    );
    await screen.findByText(`Reply ${id}`);
  }

  height = 800;
  await reply(102);
  expect(list.scrollTop).toBe(800);
  list.scrollTop = 100;
  fireEvent.scroll(list);
  height = 1000;
  await reply(103);
  expect(list.scrollTop).toBe(100);
  list.scrollTop = 800;
  fireEvent.scroll(list);
  height = 1200;
  await reply(104);
  expect(list.scrollTop).toBe(1200);
  expect(within(list).getAllByRole("listitem").at(-1)).toHaveTextContent("Reply 104");
});

it("always shows live startup and tool activity outside history until the Watcher becomes idle", async () => {
  serve(true, true);
  mount();
  await screen.findByText("Newest answer");
  const history = screen.getByRole("list", { name: "Messages, oldest first" });
  history.scrollTop = 0;
  fireEvent.scroll(history);
  const update = (status: "starting" | "working" | "idle", activity: ReturnType<typeof agent>["activity"]) => {
    act(() =>
      source().emit({
        ...eventBase,
        type: "participant.updated",
        payload: { participant: agent(WATCHER_NAME, 4, { status, activity }) },
      }),
    );
  };
  update("starting", null);
  expect(screen.getByRole("status")).toHaveTextContent("Watcher: starting…");
  update("working", { kind: "tool", toolName: "swarm_agent_activity" });
  expect(screen.getByRole("status")).toHaveTextContent("Watcher: running swarm_agent_activity…");
  expect(history).toHaveAttribute("aria-busy", "true");
  expect(within(history).queryByRole("status")).not.toBeInTheDocument();
  update("working", { kind: "writing" });
  expect(screen.getByRole("status")).toHaveTextContent("Watcher: writing…");
  update("working", { kind: "thinking" });
  expect(screen.getByRole("status")).toHaveTextContent("Watcher: thinking…");
  update("idle", null);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(history).toHaveAttribute("aria-busy", "false");
});

it("recovers session answer and actionable error after work ends without a saved reply", async () => {
  const messages = serve(true, true);
  let fallback: { questionId: number; text: string; error: string | null } | undefined;
  api.on("GET", "/api/swarms/3/watcher", () => ({ thread: thread(9, ["User", WATCHER_NAME]), messages, fallback }));
  mount();
  await screen.findByText("Newest answer");
  fallback = {
    questionId: 100,
    text: "**Recovered answer**",
    error: "Database schema v8 is newer than supported v4. Restart with the matching extension.",
  };
  act(() =>
    source().emit({
      ...eventBase,
      type: "participant.updated",
      payload: { participant: agent(WATCHER_NAME, 4, { status: "idle" }) },
    }),
  );
  expect(await screen.findByText("Recovered answer")).toBeInTheDocument();
  expect(screen.getByText("Recovered answer").tagName).toBe("STRONG");
  expect(screen.getByRole("alert")).toHaveTextContent("Database schema v8 is newer than supported v4");
  expect(
    screen.getByText("Recovered from Watcher session for question #100. No chat reply was saved."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows availability only in the placeholder, queues questions and reloads on new messages", async () => {
  serve(false);
  mount();
  const composer = await screen.findByRole("textbox", { name: "Watcher starts with the next run" });
  await screen.findByText("Newest answer");
  expect(composer).toHaveAttribute("placeholder", "Watcher starts with the next run");
  expect(screen.queryByText("Watcher starts with the next run")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(composer).toBeEnabled();
  const user = userEvent.setup();
  await user.type(composer, "What did they finish?");
  await user.click(screen.getByRole("button", { name: "Send" }));
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

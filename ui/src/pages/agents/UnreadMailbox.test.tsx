import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { AgentsPage } from "./AgentsPage";
import { detail, eventBase, mailbox, mailboxThread, message, thread } from "./testFixtures";

let api: FakeApi;
let source: () => FakeEventSource;
let read = false;
const record = thread(2, ["User", "John"]);
const unread = message(2, "John", [["User", "delivered"]], "An unread conversation");
const seen = message(4, "John", [["User", "read"]], "Already seen conversation");

beforeEach(() => {
  read = false;
  source = installFakeEventSource();
  api = installFakeApi();
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/3/participants/User/messages", ({ query }) => {
    if (query.get("box") === "sent") return mailbox("User", "sent", []);
    const only = query.get("unreadOnly") === "true";
    const items = read ? [] : [mailboxThread(record, [unread], "User")];
    return {
      ...mailbox(
        "User",
        "inbox",
        only ? items : [...items, mailboxThread(thread(4, ["User", "John"]), [seen], "User")],
      ),
      ...(only ? { unreadOnly: true } : {}),
    };
  });
  api.on("GET", "/api/swarms/3/participants/John/messages", () => mailbox("John", "inbox", []));
  api.on("GET", "/api/swarms/3/threads/2", () => ({ thread: record, messages: [unread] }));
  api.on("POST", "/api/swarms/3/participants/User/read", () => {
    read = true;
    return { updated: 1, unread: 0 };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(name = "User") {
  render(
    <MemoryRouter
      initialEntries={[`/s/3/agents/${name}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/agents/:name?" element={<AgentsPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
}

it("toggles User unread filtering and restores all messages", async () => {
  mount();
  await screen.findByText("Already seen conversation");
  const toggle = screen.getByRole("button", { name: "Show only unread" });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await screen.findByText("An unread conversation");
  expect(screen.queryByText("Already seen conversation")).not.toBeInTheDocument();
  expect(api.calls.some((call) => call.query.get("unreadOnly") === "true")).toBe(true);
  await userEvent.click(toggle);
  await screen.findByText("Already seen conversation");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("radio", { name: "Sent" }));
  await screen.findByText("Nothing sent yet");
  expect(screen.queryByRole("button", { name: "Show only unread" })).not.toBeInTheDocument();
});

it("keeps an opened conversation visible after marking read, then removes it on close", async () => {
  mount();
  await screen.findByText("An unread conversation");
  await userEvent.click(screen.getByRole("button", { name: "Show only unread" }));
  const panel = screen.getByRole("region", { name: "Mailbox" });
  await userEvent.click(await within(panel).findByRole("button", { name: /An unread conversation/ }));
  await screen.findByRole("list", { name: "Thread #2" });
  await waitFor(() => expect(read).toBe(true));
  const recipient = { name: "User", status: "read" as const, deliveredAt: unread.createdAt, readAt: unread.createdAt };
  act(() =>
    source().emit({
      ...eventBase,
      type: "message.status",
      payload: { messageId: unread.id, threadId: record.id, recipient, unread: { User: 0 } },
    }),
  );
  await waitFor(() =>
    expect(api.calls.filter((call) => call.query.get("unreadOnly") === "true").length).toBeGreaterThan(1),
  );
  expect(screen.getByRole("list", { name: "Thread #2" })).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole("button", { name: /An unread conversation/ }));
  await screen.findByText("No unread messages");
});

it("explains an old backend instead of waiting indefinitely for filtered data", async () => {
  api.on("GET", "/api/swarms/3/participants/User/messages", () =>
    mailbox("User", "inbox", [mailboxThread(record, [unread], "User")]),
  );
  mount();
  await screen.findByText("An unread conversation");
  await userEvent.click(screen.getByRole("button", { name: "Show only unread" }));
  await screen.findByText(/running backend needs a reload/);
  await userEvent.click(screen.getByRole("button", { name: "Show only unread" }));
  await screen.findByText("An unread conversation");
});

it("does not expose the unread toggle in an agent mailbox", async () => {
  mount("John");
  await screen.findByText("No messages yet");
  expect(screen.queryByRole("button", { name: "Show only unread" })).not.toBeInTheDocument();
});

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WatcherChatResponse } from "../../../../src/api-types";
import { jsonResponse } from "../../test/fakeApi";
import { conversation, deferred, emptyChat, setupWatcher } from "./testFixtures";

let test: ReturnType<typeof setupWatcher>;
beforeEach(() => {
  test = setupWatcher();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("ignores an older snapshot when updates finish out of order", async () => {
  test.update(conversation());
  test.mount();
  await screen.findByText("Three tasks remain.");
  const old = deferred<WatcherChatResponse>();
  test.api.on("GET", "/api/swarms/3/watcher", () => old.promise);
  test.emit();
  test.api.on("GET", "/api/swarms/3/watcher", () => ({
    ...conversation(),
    messages: [{ id: "latest", role: "assistant", text: "Latest reply", createdAt: 3 }],
  }));
  test.emit();
  await screen.findByText("Latest reply");
  await act(async () => old.resolve(conversation()));
  expect(screen.getByText("Latest reply")).toBeInTheDocument();
  expect(screen.queryByText("Three tasks remain.")).not.toBeInTheDocument();
});

it("invalidates old snapshots across New and fetches events received during reset", async () => {
  test.update(conversation());
  test.mount();
  await screen.findByText("Three tasks remain.");
  const old = deferred<WatcherChatResponse>();
  const reset = deferred<WatcherChatResponse>();
  test.api.on("GET", "/api/swarms/3/watcher", () => old.promise);
  test.emit();
  test.api.on("POST", "/api/swarms/3/watcher/new", () => reset.promise);
  await userEvent.click(screen.getByRole("button", { name: "New" }));
  expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
  const before = test.api.callsTo("GET", "/api/swarms/3/watcher").length;
  test.emit();
  expect(test.api.callsTo("GET", "/api/swarms/3/watcher")).toHaveLength(before);
  const fresh = emptyChat("session-2");
  test.api.on("GET", "/api/swarms/3/watcher", () => fresh);
  await act(async () => reset.resolve(fresh));
  await waitFor(() => expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement());
  expect(test.api.callsTo("GET", "/api/swarms/3/watcher")).toHaveLength(before + 1);
  await act(async () => old.resolve(conversation()));
  expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([
  { sessionId: null, status: 409 },
  { sessionId: "session-1", status: 409 },
  { sessionId: null, status: 202 },
  { sessionId: "session-1", status: 202 },
])("New ignores a late send response with HTTP $status for session $sessionId", async ({ sessionId, status }) => {
  test.update(emptyChat(sessionId));
  const send = deferred<Response>();
  test.api.on("POST", "/api/swarms/3/watcher", () => send.promise);
  test.api.on("POST", "/api/swarms/3/watcher/new", () => {
    const fresh = emptyChat("session-2");
    test.update(fresh);
    return jsonResponse(201, fresh);
  });
  test.mount();
  await userEvent.type(screen.getByRole("textbox"), "Old question");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(test.api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({
    text: "Old question",
    sessionId,
  });
  expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "New" }));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  await userEvent.type(screen.getByRole("textbox"), "New draft");
  await act(async () =>
    send.resolve(
      status === 409
        ? jsonResponse(409, { error: "stale_session", message: "Old session" })
        : jsonResponse(202, { ...conversation(), status: "working" }),
    ),
  );
  expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement();
  expect(screen.getByRole("textbox")).toHaveValue("New draft");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("never shows an old swarm snapshot after navigation", async () => {
  const old = deferred<WatcherChatResponse>();
  test.api.on("GET", "/api/swarms/3/watcher", () => old.promise);
  const router = test.mount();
  test.update(
    {
      ...emptyChat("other-session"),
      messages: [{ id: "other", role: "assistant", text: "Other swarm", createdAt: 1 }],
    },
    4,
  );
  await act(async () => router.navigate("/s/4/watcher"));
  await screen.findByText("Other swarm");
  await act(async () => old.resolve(conversation()));
  expect(screen.getByText("Other swarm")).toBeInTheDocument();
  expect(screen.queryByText("Three tasks remain.")).not.toBeInTheDocument();
});

it("isolates pending send failures and drafts when navigating between swarms", async () => {
  const send = deferred<Response>();
  test.api.on("POST", "/api/swarms/3/watcher", () => send.promise);
  const router = test.mount();
  await userEvent.type(screen.getByRole("textbox"), "Swarm three draft");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await act(async () => router.navigate("/s/4/watcher"));
  expect(screen.getByRole("textbox")).toHaveValue("");
  await userEvent.type(screen.getByRole("textbox"), "Swarm four draft");
  await act(async () => send.resolve(jsonResponse(500, { error: "internal", message: "Old failure" })));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Swarm four draft");
  await act(async () => router.navigate("/s/3/watcher"));
  expect(screen.getByRole("textbox")).toHaveValue("Swarm three draft");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps the scroll position while reading and follows replies only near the bottom", async () => {
  test.update(conversation());
  test.mount();
  await screen.findByText("Three tasks remain.");
  const history = screen.getByRole("region", { name: "Chat history" });
  let height = 1000;
  Object.defineProperties(history, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 200 },
  });
  history.scrollTop = 300;
  fireEvent.scroll(history);
  test.emit();
  await act(async () => {});
  expect(history.scrollTop).toBe(300);
  history.scrollTop = 800;
  fireEvent.scroll(history);
  height = 1200;
  test.emit();
  await waitFor(() => expect(history.scrollTop).toBe(1200));
});

it("does not yank the scroll for an own send while reading older messages", async () => {
  test.update(conversation());
  test.api.on("POST", "/api/swarms/3/watcher", () => {
    const response: WatcherChatResponse = {
      ...conversation(),
      status: "working",
      messages: [...conversation().messages, { id: "own", role: "user", text: "New question", createdAt: 3 }],
    };
    test.update(response);
    return jsonResponse(202, response);
  });
  test.mount();
  await screen.findByText("Three tasks remain.");
  const history = screen.getByRole("region", { name: "Chat history" });
  Object.defineProperties(history, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  history.scrollTop = 300;
  fireEvent.scroll(history);
  await userEvent.type(screen.getByRole("textbox"), "New question");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("New question");
  expect(history.scrollTop).toBe(300);
});

it("resets scroll following after New even when the old session was scrolled up", async () => {
  test.update(conversation());
  test.api.on("POST", "/api/swarms/3/watcher/new", () => {
    const fresh = emptyChat("session-2");
    test.update(fresh);
    return jsonResponse(201, fresh);
  });
  test.mount();
  await screen.findByText("Three tasks remain.");
  const history = screen.getByRole("region", { name: "Chat history" });
  let height = 1000;
  Object.defineProperties(history, { scrollHeight: { get: () => height }, clientHeight: { value: 200 } });
  history.scrollTop = 300;
  fireEvent.scroll(history);
  height = 0;
  await userEvent.click(screen.getByRole("button", { name: "New" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement());
  height = 1200;
  test.update({
    ...emptyChat("session-2"),
    messages: [{ id: "fresh", role: "assistant", text: "Fresh response", createdAt: 3 }],
  });
  test.emit();
  await screen.findByText("Fresh response");
  expect(history.scrollTop).toBe(1200);
});

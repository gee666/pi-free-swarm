import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../../test/fakeApi";
import { eventBase } from "../agents/testFixtures";
import { conversation, deferred, emptyChat, setupWatcher } from "./testFixtures";
import type { WatcherChatResponse } from "../../../../src/api-types";

let test: ReturnType<typeof setupWatcher>;
beforeEach(() => {
  test = setupWatcher();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens an empty private chat without Wall elements, mentions, uploads or status prose", async () => {
  test.mount();
  expect(screen.getByRole("heading", { name: "Watcher" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Message Watcher" })).toHaveValue("");
  expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement();
  expect(screen.queryByText(/wall|notify|saved|resume|ask watcher/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Attach file" })).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "@Wat");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(test.api.calls.every((call) => call.path === "/api/swarms/3/watcher")).toBe(true);
});

it("sends plain text with the existing keyboard shortcut and refetches working replies", async () => {
  const working: WatcherChatResponse = {
    ...conversation(),
    messages: conversation().messages.slice(0, 1),
    status: "working",
  };
  test.api.on("POST", "/api/swarms/3/watcher", () => {
    test.update(working);
    return jsonResponse(202, working);
  });
  test.mount();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "Status?");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(input).toHaveValue(""));
  expect(test.api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({ text: "Status?", sessionId: null });
  expect(await screen.findByRole("status")).toHaveTextContent("Working…");
  await userEvent.type(input, "Next question");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
  test.update(conversation());
  test.emit();
  expect(await screen.findByText("Three tasks remain.")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  expect(screen.getByRole("textbox")).toHaveValue("Next question");
  const messages = within(screen.getByRole("list", { name: "Watcher conversation" })).getAllByRole("listitem");
  expect(messages[0]).toHaveTextContent("You");
  expect(messages[0]).toHaveTextContent("Status?");
  expect(messages[1]).toHaveTextContent("Watcher");
});

it("New replaces a working session with a fresh empty chat and sends without old history", async () => {
  test.update({ ...conversation(), status: "working" });
  test.api.on("POST", "/api/swarms/3/watcher/new", () => {
    const fresh = emptyChat("session-2");
    test.update(fresh);
    return jsonResponse(201, fresh);
  });
  test.api.on("POST", "/api/swarms/3/watcher", () => {
    const response: WatcherChatResponse = {
      ...emptyChat("session-2"),
      messages: [{ id: "new-user", role: "user", text: "Fresh question", createdAt: 3 }],
      status: "working",
    };
    test.update(response);
    return jsonResponse(202, response);
  });
  test.mount();
  await screen.findByText("Three tasks remain.");
  await userEvent.type(screen.getByRole("textbox"), "Old draft");
  await userEvent.click(screen.getByRole("button", { name: "New" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Watcher conversation" })).toBeEmptyDOMElement());
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(test.api.callsTo("POST", "/api/swarms/3/watcher/new")).toHaveLength(1);
  await userEvent.type(screen.getByRole("textbox"), "Fresh question");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Fresh question")).toBeInTheDocument();
  expect(screen.queryByText("Status?")).not.toBeInTheDocument();
  expect(screen.queryByText("Three tasks remain.")).not.toBeInTheDocument();
  expect(test.api.callsTo("POST", "/api/swarms/3/watcher")[0]?.body).toEqual({
    text: "Fresh question",
    sessionId: "session-2",
  });
  expect(test.api.calls.every((call) => !/wall|posts|comments|read/.test(call.path))).toBe(true);
});

it.each([409, 500])("preserves the draft after a failed send with HTTP %s", async (status) => {
  test.api.on("POST", "/api/swarms/3/watcher", () =>
    jsonResponse(status, { error: "unavailable", message: "Unavailable" }),
  );
  test.mount();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "Keep this draft");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(input).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  test.update(conversation());
  act(() => test.source().open());
  expect(await screen.findByText("Three tasks remain.")).toBeInTheDocument();
  expect(input).toHaveValue("Keep this draft");
});

it("keeps messages and the draft when New fails", async () => {
  test.update(conversation());
  test.api.on("POST", "/api/swarms/3/watcher/new", () =>
    jsonResponse(500, { error: "internal", message: "Reset failed" }),
  );
  test.mount();
  await screen.findByText("Three tasks remain.");
  await userEvent.type(screen.getByRole("textbox"), "Keep my draft");
  await userEvent.click(screen.getByRole("button", { name: "New" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reset failed");
  expect(screen.getByText("Three tasks remain.")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Keep my draft");
  expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
});

it("shows real snapshot and load errors, with Retry for failed loads", async () => {
  test.api.on("GET", "/api/swarms/3/watcher", () =>
    jsonResponse(503, { error: "unavailable", message: "Chat unavailable" }),
  );
  test.mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Chat unavailable");
  test.api.on("GET", "/api/swarms/3/watcher", () => ({
    ...conversation(),
    status: "error",
    error: "Model failed",
  }));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Model failed");
  test.api.on("GET", "/api/swarms/3/watcher", () => conversation());
  test.emit();
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("ignores Wall events and updates for other swarms", async () => {
  test.update(conversation());
  test.mount();
  await screen.findByText("Three tasks remain.");
  const before = test.api.calls.length;
  act(() => {
    test.source().emit({
      ...eventBase,
      type: "comment.created",
      payload: {
        comment: { id: 9, swarmId: 3, postId: 7, author: "Watcher", text: "Wall reply", createdAt: 3 },
        commentCount: 1,
      },
    });
  });
  test.emit(4);
  expect(test.api.calls).toHaveLength(before);
  expect(screen.queryByText("Wall reply")).not.toBeInTheDocument();
});

it("preserves transcript sequence despite clock changes and renders Markdown and code", async () => {
  test.update({
    ...conversation(),
    messages: [
      { id: "user", role: "user", text: "First", createdAt: 2 },
      { id: "assistant", role: "assistant", text: "**Ready**\n\n```\nconst answer = 42;\n```", createdAt: 1 },
    ],
  });
  test.mount();
  expect(await screen.findByText("Ready")).toHaveProperty("tagName", "STRONG");
  expect(screen.getByText("const answer = 42;")).toHaveProperty("tagName", "CODE");
  const messages = within(screen.getByRole("list", { name: "Watcher conversation" })).getAllByRole("listitem");
  expect(messages[0]).toHaveTextContent("First");
  expect(messages[1]).toHaveTextContent("Ready");
});

it("preserves edits made while a send is pending", async () => {
  const send = deferred<WatcherChatResponse>();
  test.api.on("POST", "/api/swarms/3/watcher", () => send.promise);
  test.mount();
  const input = screen.getByRole("textbox", { name: "Message Watcher" });
  await userEvent.type(input, "Status?");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await userEvent.type(input, " More");
  test.update(conversation());
  await act(async () => send.resolve(conversation()));
  expect(input).toHaveValue("Status? More");
});

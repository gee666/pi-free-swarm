import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmViewProvider, useSwarmDetail } from "./SwarmView";
import { installFakeEventSource, FakeEventSource } from "../test/fakeEventSource";
import { jsonResponse } from "../test/fakeApi";
import { detail, eventBase, message } from "../pages/agents/testFixtures";

function Read({ id, label }: { id: string; label: string }) {
  const { data, error } = useSwarmDetail(id);
  const user = data?.participants.find((participant) => participant.kind === "user");
  return (
    <p>
      {label}:{" "}
      {error
        ? `Error ${error.message}`
        : data
          ? `${data.swarm.name} ${data.userUnread?.messages}/${data.userUnread?.comments} User ${user?.unread}`
          : "Loading"}
    </p>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads one diagnostic snapshot when an initial scoped stream fails, then refreshes on its first open", async () => {
  const source = installFakeEventSource();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(404, { error: "not_found", message: "Swarm #999 not found" }))
    .mockResolvedValueOnce(jsonResponse(200, detail({ id: 999, name: "newly created scope" })));
  const view = render(
    <SwarmViewProvider swarmId="999">
      <Read id="999" label="Current" />
    </SwarmViewProvider>,
  );
  expect(fetch).not.toHaveBeenCalled();
  act(() => {
    source().close();
    source().onerror?.();
  });
  expect(await screen.findByText("Current: Error Swarm #999 not found")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  view.rerender(
    <SwarmViewProvider swarmId="999">
      <Read id="999" label="Current" />
    </SwarmViewProvider>,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => source().open());
  expect(await screen.findByText(/Current: newly created scope/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(source().readyState).toBe(FakeEventSource.CLOSED);
});

it("shares snapshot patches and authoritative User unread totals without extra message-event fetches", async () => {
  const source = installFakeEventSource();
  let finish: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => pending);
  render(
    <SwarmViewProvider swarmId="3">
      <Read id="3" label="Header" />
      <Read id="3" label="Page" />
    </SwarmViewProvider>,
  );
  expect(fetch).not.toHaveBeenCalled();
  act(() => source().open());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const incoming = message(1, "John", [["User", "delivered"]], "hello");
  act(() =>
    source().emit({
      ...eventBase,
      type: "message.created",
      payload: { message: incoming, unread: { User: 3 }, userUnread: { messages: 2, comments: 1 } },
    }),
  );
  finish?.(jsonResponse(200, { ...detail(), userUnread: { messages: 1, comments: 0 } }));
  expect(await screen.findByText("Header: auth-refactor 2/1 User 3")).toBeInTheDocument();
  expect(screen.getByText("Page: auth-refactor 2/1 User 3")).toBeInTheDocument();
  act(() =>
    source().emit({
      ...eventBase,
      type: "message.status",
      payload: {
        messageId: incoming.id,
        threadId: incoming.threadId,
        recipient: { name: "User", status: "read", deliveredAt: 1, readAt: 2 },
        unread: { User: 2 },
        userUnread: { messages: 1, comments: 1 },
      },
    }),
  );
  expect(await screen.findByText("Header: auth-refactor 1/1 User 2")).toBeInTheDocument();
  expect(screen.getByText("Page: auth-refactor 1/1 User 2")).toBeInTheDocument();
  act(() =>
    source().emit({
      ...eventBase,
      type: "message.status",
      payload: {
        messageId: incoming.id,
        threadId: incoming.threadId,
        recipient: { name: "User", status: "read", deliveredAt: 1, readAt: 2 },
        unread: { User: 2 },
      },
    }),
  );
  expect(screen.getByText("Page: auth-refactor 1/1 User 2")).toBeInTheDocument();
  act(() =>
    source().emit({
      ...eventBase,
      type: "user.post.updated",
      payload: { postId: 7, userSubscribed: false, userUnreadComments: 0, userUnread: { messages: 1, comments: 0 } },
    }),
  );
  expect(await screen.findByText("Header: auth-refactor 1/0 User 2")).toBeInTheDocument();
  expect(screen.getByText("Page: auth-refactor 1/0 User 2")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts a retired route snapshot and ignores its late response without retaining another swarm", async () => {
  const source = installFakeEventSource();
  let finish: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const signals = new Map<string, AbortSignal>();
  let requests = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const path = String(input);
    if (init?.signal) signals.set(path, init.signal);
    if (path.endsWith("/3"))
      return ++requests === 1 ? Promise.resolve(jsonResponse(200, detail({ name: "old scope initial" }))) : pending;
    return Promise.resolve(jsonResponse(200, detail({ id: 4, name: "new scope" })));
  });
  const view = render(
    <SwarmViewProvider swarmId="3">
      <Read id="3" label="Current" />
    </SwarmViewProvider>,
  );
  act(() => source().open());
  expect(await screen.findByText(/Current: old scope initial/)).toBeInTheDocument();
  act(() =>
    source().emit({
      ...eventBase,
      type: "usage.updated",
      payload: { agent: "John", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1, turns: 1 } },
    }),
  );
  await waitFor(() => expect(requests).toBe(2));
  const oldSource = source();
  view.rerender(
    <SwarmViewProvider swarmId="4">
      <Read id="4" label="Current" />
    </SwarmViewProvider>,
  );
  expect(screen.getByText("Current: Loading")).toBeInTheDocument();
  expect(screen.queryByText(/old scope initial/)).not.toBeInTheDocument();
  expect(oldSource.readyState).toBe(FakeEventSource.CLOSED);
  expect(signals.get("/api/swarms/3")?.aborted).toBe(true);
  act(() => source().open());
  expect(await screen.findByText(/Current: new scope/)).toBeInTheDocument();
  await act(async () => {
    finish?.(jsonResponse(200, detail({ name: "old scope" })));
  });
  expect(screen.getByText(/Current: new scope/)).toBeInTheDocument();
  expect(screen.queryByText(/Current: old scope/)).not.toBeInTheDocument();
  view.unmount();
  expect(source().readyState).toBe(FakeEventSource.CLOSED);
  expect(signals.get("/api/swarms/4")?.aborted).toBe(true);
});

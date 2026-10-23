import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserPostAttention } from "../../../../src/api-types";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { eventBase } from "../agents/testFixtures";
import { PostSubscriptionButton } from "./PostSubscriptionButton";

let api: FakeApi;
let source: () => FakeEventSource;
const url = (id = 1) => `/api/swarms/3/posts/${id}/subscription`;
const state = (subscribed: boolean, postId = 1): UserPostAttention => ({
  postId,
  userSubscribed: subscribed,
  userUnreadComments: subscribed ? 2 : 0,
  userUnread: { messages: 1, comments: subscribed ? 2 : 0 },
});

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!settle) throw new Error("Uninitialized deferred result");
      settle(value);
    },
  };
}

beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function control(subscribed: boolean | undefined, onChange?: (value: UserPostAttention) => void, postId = 1) {
  return (
    <SwarmStreamProvider swarmId="3">
      <PostSubscriptionButton swarmId={3} postId={postId} subscribed={subscribed} onChange={onChange} />
    </SwarmStreamProvider>
  );
}
function emit(value: UserPostAttention, swarmId = 3) {
  act(() => source().emit({ ...eventBase, swarmId, type: "user.post.updated", payload: value }));
}

it("renders the small accessible toggle from supplied state and writes once without a redundant GET", async () => {
  const changed = vi.fn();
  api.on("POST", url(), () => state(false));
  render(control(true, changed));
  const button = screen.getByRole("button", { name: "Unsubscribe from comments" });
  expect(button).toHaveAttribute("aria-pressed", "true");
  expect(api.callsTo("GET", url())).toHaveLength(0);
  await userEvent.click(button);
  await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe to comments" })).toBeEnabled());
  expect(api.callsTo("POST", url())[0]?.body).toEqual({ subscribed: false });
  expect(api.callsTo("POST", url())).toHaveLength(1);
  expect(api.callsTo("GET", url())).toHaveLength(0);
  expect(changed).toHaveBeenLastCalledWith(state(false));
});

it("follows authoritative subscription events including automatic follows and isolates other posts/swarms", () => {
  render(control(false));
  emit(state(true, 2));
  emit(state(true), 4);
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toHaveAttribute("aria-pressed", "false");
  emit(state(true));
  expect(screen.getByRole("button", { name: "Unsubscribe from comments" })).toHaveAttribute("aria-pressed", "true");
  emit(state(false));
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toBeEnabled();
  expect(api.calls).toHaveLength(0);
});

it("preserves a newer live state over a late POST response, even when it equals the original boolean", async () => {
  const write = deferred<UserPostAttention>();
  const changed = vi.fn();
  api.on("POST", url(), () => write.promise);
  render(control(false, changed));
  await userEvent.click(screen.getByRole("button", { name: "Subscribe to comments" }));
  emit(state(false));
  await act(async () => {
    write.resolve(state(true));
  });
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toHaveAttribute("aria-pressed", "false");
  expect(changed).not.toHaveBeenCalledWith(state(true));
  expect(api.callsTo("POST", url())).toHaveLength(1);
});

it("requires a safe read after an uncertain write and never retries that write automatically", async () => {
  api.on("POST", url(), () => jsonResponse(503, { error: "unavailable", message: "Outcome unknown." }));
  api.on("GET", url(), () => state(true));
  render(control(false));
  await userEvent.click(screen.getByRole("button", { name: "Subscribe to comments" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("previous write may have succeeded");
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toBeDisabled();
  expect(api.callsTo("GET", url())).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Refresh subscription" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Unsubscribe from comments" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(api.callsTo("GET", url())).toHaveLength(1);
  expect(api.callsTo("POST", url())).toHaveLength(1);
});

it("replays live state over an older fallback snapshot when legacy post metadata is missing", async () => {
  const read = deferred<UserPostAttention>();
  api.on("GET", url(), () => read.promise);
  render(control(undefined));
  expect(screen.getByRole("button", { name: "Subscription status unavailable" })).toBeDisabled();
  emit(state(true));
  await act(async () => {
    read.resolve(state(false));
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Unsubscribe from comments" })).toBeEnabled());
  expect(api.callsTo("GET", url())).toHaveLength(1);
  expect(api.callsTo("POST", url())).toHaveLength(0);
});

it("aborts retired selection writes so their late responses cannot modify the next post", async () => {
  const write = deferred<UserPostAttention>();
  const changed = vi.fn();
  api.on("POST", url(), () => write.promise);
  const view = render(control(false, changed));
  await userEvent.click(screen.getByRole("button", { name: "Subscribe to comments" }));
  view.rerender(control(false, changed, 2));
  await act(async () => {
    write.resolve(state(true));
  });
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toHaveAttribute("aria-pressed", "false");
  expect(changed).not.toHaveBeenCalled();
});

it("retires fallback reads across stream epochs so an older GET cannot overwrite the reopened state", async () => {
  const older = deferred<UserPostAttention>();
  const newer = deferred<UserPostAttention>();
  let reads = 0;
  api.on("GET", url(), () => {
    reads++;
    return reads === 1 ? state(false) : reads === 2 ? older.promise : newer.promise;
  });
  render(control(undefined));
  await screen.findByRole("button", { name: "Subscribe to comments" });
  act(() => source().open());
  act(() => {
    source().onerror?.();
    source().open();
  });
  await act(async () => newer.resolve(state(true)));
  await waitFor(() => expect(screen.getByRole("button", { name: "Unsubscribe from comments" })).toBeEnabled());
  await act(async () => older.resolve(state(false)));
  expect(screen.getByRole("button", { name: "Unsubscribe from comments" })).toHaveAttribute("aria-pressed", "true");
  expect(api.callsTo("GET", url())).toHaveLength(3);
  expect(api.callsTo("POST", url())).toHaveLength(0);
});

it("does not overwrite a fresh reconnect snapshot with an older successful mutation response", async () => {
  const write = deferred<UserPostAttention>();
  const changed = vi.fn();
  api.on("POST", url(), () => write.promise);
  const view = render(control(false, changed));
  act(() => source().open());
  await userEvent.click(screen.getByRole("button", { name: "Subscribe to comments" }));
  act(() => {
    source().readyState = EventSource.CONNECTING;
    source().onerror?.();
    source().open();
  });
  // A retention gap can omit the mutation events; the new snapshot confirms the original boolean.
  view.rerender(control(false, changed));
  await act(async () => write.resolve(state(true)));
  expect(screen.getByRole("button", { name: "Subscribe to comments" })).toHaveAttribute("aria-pressed", "false");
  expect(changed).not.toHaveBeenCalledWith(state(true));
});

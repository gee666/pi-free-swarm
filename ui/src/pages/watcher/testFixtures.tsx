import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useParams } from "react-router-dom";
import type { WatcherChatResponse } from "../../../../src/api-types";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { ComposerDraftsProvider } from "../../components/compose/ComposerDrafts";
import { installFakeApi } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { eventBase } from "../agents/testFixtures";
import { WatcherPage } from "./WatcherPage";

export function emptyChat(sessionId: string | null = null): WatcherChatResponse {
  return { sessionId, messages: [], status: "idle", error: null };
}

export function conversation(): WatcherChatResponse {
  return {
    ...emptyChat("session-1"),
    messages: [
      { id: "user-1", role: "user", text: "Status?", createdAt: 1 },
      { id: "assistant-1", role: "assistant", text: "Three tasks remain.", createdAt: 2 },
    ],
  };
}

function TestFrame() {
  const { id = "" } = useParams();
  return (
    <SwarmStreamProvider key={id} swarmId={id}>
      <WatcherPage />
    </SwarmStreamProvider>
  );
}

export function setupWatcher() {
  const source = installFakeEventSource();
  const api = installFakeApi();
  const responses = new Map<number, WatcherChatResponse>();
  for (const id of [3, 4]) {
    responses.set(id, emptyChat());
    api.on("GET", `/api/swarms/${id}/watcher`, () => responses.get(id));
  }
  return {
    api,
    source,
    update: (response: WatcherChatResponse, swarmId = 3) => responses.set(swarmId, response),
    emit: (swarmId = 3) =>
      act(() => source().emit({ ...eventBase, type: "watcher.chat.updated", payload: { swarmId } })),
    mount: () => {
      const router = createMemoryRouter([{ path: "/s/:id/watcher", element: <TestFrame /> }], {
        initialEntries: ["/s/3/watcher"],
      });
      render(
        <ComposerDraftsProvider>
          <RouterProvider router={router} />
        </ComposerDraftsProvider>,
      );
      act(() => source().open());
      return router;
    },
  };
}

export function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (!settle) throw new Error("Uninitialized deferred result");
      settle(value);
    },
  };
}

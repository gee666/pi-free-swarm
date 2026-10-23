import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmListProvider, useSwarmList } from "./SwarmList";
import { installFakeApi, jsonResponse } from "../test/fakeApi";
import { installFakeEventSource, FakeEventSource } from "../test/fakeEventSource";
import { swarm, eventBase } from "../pages/agents/testFixtures";

function View() {
  const { list } = useSwarmList();
  return <p>{list.data?.swarms.map((item) => item.name).join(", ") ?? "Loading list"}</p>;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens one index feed and fetches once after handshake, merging new swarms without polling", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  const next = { ...swarm, id: 4, name: "new swarm" };
  let rows = [swarm];
  api.on("GET", "/api/swarms", () => ({ swarms: rows }));
  const view = render(
    <SwarmListProvider>
      <View />
    </SwarmListProvider>,
  );
  expect(source().url).toBe("/events");
  expect(api.callsTo("GET", "/api/swarms")).toHaveLength(0);
  act(() => source().open());
  expect(await screen.findByText("auth-refactor")).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms")).toHaveLength(1);
  rows = [next, swarm];
  act(() => source().emit({ ...eventBase, swarmId: next.id, type: "swarm.updated", payload: { swarm: next } }));
  expect(await screen.findByText("new swarm, auth-refactor")).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms")).toHaveLength(1);
  act(() => source().open());
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms")).toHaveLength(2));
  view.unmount();
  expect(source().readyState).toBe(FakeEventSource.CLOSED);
});

it("replays index changes over a concurrent snapshot without another fetch", async () => {
  const source = installFakeEventSource();
  let finish: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => pending);
  render(
    <SwarmListProvider>
      <View />
    </SwarmListProvider>,
  );
  act(() => source().open());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const next = { ...swarm, id: 4, name: "arrived during snapshot" };
  act(() => source().emit({ ...eventBase, swarmId: 4, type: "swarm.updated", payload: { swarm: next } }));
  expect(finish).toBeDefined();
  finish?.(jsonResponse(200, { swarms: [swarm] }));
  expect(await screen.findByText("arrived during snapshot, auth-refactor")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

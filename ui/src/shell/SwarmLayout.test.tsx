import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmListProvider } from "../api/SwarmList";
import { installFakeApi } from "../test/fakeApi";
import { installFakeEventSource, FakeEventSource } from "../test/fakeEventSource";
import { swarm, detail, eventBase } from "../pages/agents/testFixtures";
import { SwarmLayout } from "./SwarmLayout";

function CurrentPage() {
  const { id, tab } = useParams();
  return (
    <h1>
      Current {id}/{tab}
    </h1>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps selectors live across scoped pages and selection changes with one shared index feed", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  const next = { ...swarm, id: 4, name: "new swarm" };
  const later = { ...swarm, id: 5, name: "later swarm" };
  let rows = [swarm];
  api.on("GET", "/api/swarms", () => ({ swarms: rows }));
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/4", () => detail(next));
  const view = render(
    <MemoryRouter initialEntries={["/s/3/config"]}>
      <SwarmListProvider>
        <Routes>
          <Route path="/s/:id" element={<SwarmLayout />}>
            <Route path=":tab" element={<CurrentPage />} />
          </Route>
        </Routes>
      </SwarmListProvider>
    </MemoryRouter>,
  );
  const index = FakeEventSource.instances.find((source) => source.url === "/events");
  const scoped = FakeEventSource.instances.find((source) => source.url === "/events?swarm=3");
  expect(index).toBeDefined();
  expect(scoped).toBeDefined();
  act(() => FakeEventSource.instances.forEach((source) => source.open()));
  const select = await screen.findByRole("button", { name: "auth-refactor · #3" });
  const detailCalls = api.callsTo("GET", "/api/swarms/3").length;
  rows = [next, swarm];
  act(() => index?.emit({ ...eventBase, swarmId: 4, type: "swarm.updated", payload: { swarm: next } }));
  await userEvent.click(select);
  const option = await screen.findByRole("option", { name: "new swarm · #4" });
  expect(screen.getByRole("heading", { name: "Current 3/config" })).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3")).toHaveLength(detailCalls);
  await userEvent.click(option);
  expect(await screen.findByRole("heading", { name: "Current 4/dashboard" })).toBeInTheDocument();
  expect(scoped?.readyState).toBe(FakeEventSource.CLOSED);
  expect(FakeEventSource.instances.filter((source) => source.url === "/events")).toHaveLength(1);
  expect(api.callsTo("GET", "/api/swarms")).toHaveLength(1);
  rows = [later, next, swarm];
  act(() => index?.emit({ ...eventBase, swarmId: 5, type: "swarm.updated", payload: { swarm: later } }));
  expect(screen.getByRole("heading", { name: "Current 4/dashboard" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "new swarm · #4" }));
  expect(await screen.findByRole("option", { name: "later swarm · #5" })).toBeInTheDocument();
  act(() => index?.open());
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms")).toHaveLength(2));
  view.unmount();
  expect(FakeEventSource.instances.every((source) => source.readyState === FakeEventSource.CLOSED)).toBe(true);
});

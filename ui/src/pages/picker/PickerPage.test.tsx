import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SwarmListItem } from "../../../../src/api-types";
import { latestRunningSwarm } from "../../api/swarms";
import { SwarmListProvider, useSwarmList } from "../../api/SwarmList";
import { installFakeApi, jsonResponse } from "../../test/fakeApi";
import { installFakeEventSource, FakeEventSource } from "../../test/fakeEventSource";
import { swarm, eventBase } from "../agents/testFixtures";
import { PickerPage } from "./PickerPage";

function Selected() {
  const { id } = useParams();
  return <h1>Selected swarm {id}</h1>;
}
function mount(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SwarmListProvider>
        <Routes>
          <Route path="/" element={<PickerPage />} />
          <Route path="/s/:id/:tab" element={<Selected />} />
        </Routes>
      </SwarmListProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("defaults a new page to the latest started active swarm, not the newest finished record", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  const rows: SwarmListItem[] = [
    { ...swarm, id: 9, status: "finished", acceptsMessages: false, createdAt: 900, startedAt: 900 },
    { ...swarm, id: 4, status: "starting", createdAt: 400, startedAt: 400 },
    { ...swarm, id: 3, createdAt: 100, startedAt: 500 },
  ];
  api.on("GET", "/api/swarms", () => ({ swarms: rows }));
  mount();
  act(() => source().open());
  expect(await screen.findByRole("heading", { name: "Selected swarm 3" })).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms")).toHaveLength(1);
  expect(FakeEventSource.instances).toHaveLength(1);
});

it("keeps the picker when no swarm is active, updates it live and honors manual selection", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms", () => ({ swarms: [{ ...swarm, status: "finished", acceptsMessages: false }] }));
  mount();
  act(() => source().open());
  expect(await screen.findByRole("heading", { name: "Swarms" })).toBeInTheDocument();
  const next = { ...swarm, id: 4, name: "new swarm" };
  act(() => source().emit({ ...eventBase, swarmId: 4, type: "swarm.updated", payload: { swarm: next } }));
  expect(screen.getByRole("heading", { name: "Swarms" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Select a swarm" }));
  await userEvent.click(await screen.findByRole("option", { name: "new swarm · #4" }));
  expect(await screen.findByRole("heading", { name: "Selected swarm 4" })).toBeInTheDocument();
});

it("does not replace an explicit historical swarm URL", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms", () => ({ swarms: [{ ...swarm, id: 9 }] }));
  mount("/s/3/stats");
  act(() => source().open());
  expect(await screen.findByRole("heading", { name: "Selected swarm 3" })).toBeInTheDocument();
});

it("waits for a pending reconnect snapshot before defaulting when returning to the board", async () => {
  const source = installFakeEventSource();
  let finish: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const latest = { ...swarm, id: 9, name: "latest active run", startedAt: swarm.createdAt + 1 };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(200, { swarms: [swarm] }))
    .mockImplementationOnce(() => pending)
    .mockResolvedValueOnce(jsonResponse(200, { swarms: [latest, swarm] }));
  function History() {
    const navigate = useNavigate();
    const { list } = useSwarmList();
    return (
      <>
        <p>{list.loading ? "Loading snapshot" : "Snapshot ready"}</p>
        <button onClick={() => navigate(-1)}>Return to board</button>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={["/", "/s/3/stats"]} initialIndex={1}>
      <SwarmListProvider>
        <Routes>
          <Route path="/" element={<PickerPage />} />
          <Route path="/s/3/stats" element={<History />} />
          <Route path="/s/:id/:tab" element={<Selected />} />
        </Routes>
      </SwarmListProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
  expect(await screen.findByText("Snapshot ready")).toBeInTheDocument();
  act(() => source().open());
  expect(await screen.findByText("Loading snapshot")).toBeInTheDocument();
  const older = { ...swarm, id: 2, name: "older active run", startedAt: 1 };
  act(() => source().emit({ ...eventBase, swarmId: 2, type: "swarm.updated", payload: { swarm: older } }));
  await userEvent.click(screen.getByRole("button", { name: "Return to board" }));
  expect(screen.getByRole("heading", { name: "Swarms" })).toBeInTheDocument();
  finish?.(jsonResponse(500, { error: "internal", message: "Snapshot failed" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load swarms: Snapshot failed");
  expect(screen.getByRole("heading", { name: "Swarms" })).toBeInTheDocument();
  act(() => source().open());
  expect(await screen.findByRole("heading", { name: "Selected swarm 9" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("uses creation time for old active records and deterministic ties without mutating the list", () => {
  const rows: SwarmListItem[] = [
    { ...swarm, id: 2, startedAt: null, createdAt: 500 },
    { ...swarm, id: 7, startedAt: 400, createdAt: 1000 },
    { ...swarm, id: 3, startedAt: 500, createdAt: 500 },
  ];
  expect(latestRunningSwarm(rows)?.id).toBe(3);
  expect(rows.map((item) => item.id)).toEqual([2, 7, 3]);
  expect(latestRunningSwarm(rows.map<SwarmListItem>((item) => ({ ...item, status: "stopped" })))).toBeUndefined();
});

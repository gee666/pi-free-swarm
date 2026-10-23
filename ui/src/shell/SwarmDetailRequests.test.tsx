import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmListProvider } from "../api/SwarmList";
import { AgentsPage } from "../pages/agents/AgentsPage";
import { detail, eventBase, mailbox, swarm } from "../pages/agents/testFixtures";
import { installFakeApi } from "../test/fakeApi";
import { FakeEventSource, installFakeEventSource } from "../test/fakeEventSource";
import { budget } from "../test/runConfigurationFixture";
import { SwarmLayout } from "./SwarmLayout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares one current-route detail request between the real shell and Agents page on usage updates", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  let current = detail({ budget });
  api.on("GET", "/api/swarms", () => ({ swarms: [swarm] }));
  api.on("GET", "/api/swarms/3", () => current);
  api.on("GET", "/api/swarms/3/participants/John/messages", () => mailbox("John", "inbox", []));
  const view = render(
    <MemoryRouter
      initialEntries={["/s/3/agents/John"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SwarmListProvider>
        <Routes>
          <Route path="/s/:id" element={<SwarmLayout />}>
            <Route path="agents/:name?" element={<AgentsPage />} />
          </Route>
        </Routes>
      </SwarmListProvider>
    </MemoryRouter>,
  );
  act(() => FakeEventSource.instances.forEach((source) => source.open()));
  await userEvent.click(await screen.findByRole("button", { name: /Budget/ }));
  expect(await screen.findByText(/Reported spend: \$10.5000/)).toBeInTheDocument();
  const scoped = FakeEventSource.instances.find((source) => source.url === "/events?swarm=3");
  expect(scoped).toBeDefined();
  const before = api.callsTo("GET", "/api/swarms/3").length;
  current = {
    ...current,
    swarm: { ...current.swarm, budget: { ...budget, costUsd: 11.75 } },
    participants: current.participants.map((participant) =>
      participant.kind === "user" ? { ...participant, unread: 31 } : participant,
    ),
  };
  act(() =>
    scoped?.emit({
      ...eventBase,
      type: "usage.updated",
      payload: { agent: "John", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 11.75, turns: 1 } },
    }),
  );
  expect(await screen.findByText(/Reported spend: \$11.7500/)).toBeInTheDocument();
  expect(await screen.findByText("31 unread")).toBeInTheDocument();
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3").length).toBeGreaterThan(before));
  const perUsageEvent = api.callsTo("GET", "/api/swarms/3").length - before;
  console.info(JSON.stringify({ before, after: before + perUsageEvent, perUsageEvent }));
  expect(perUsageEvent).toBe(1);
  view.unmount();
  expect(FakeEventSource.instances.every((source) => source.readyState === FakeEventSource.CLOSED)).toBe(true);
});

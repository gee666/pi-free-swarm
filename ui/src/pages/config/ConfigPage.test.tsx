import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ConfigurationChange, RuntimeConfigurationView } from "../../../../src/runtime-configuration";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi as installBaseFakeApi, jsonResponse } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { budget, configuration } from "../../test/runConfigurationFixture";
import { detail, eventBase } from "../agents/testFixtures";
import { ConfigPage } from "./ConfigPage";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installFakeApi() {
  const api = installBaseFakeApi();
  api.on("GET", "/api/swarms/3", () => detail({ budget }));
  return api;
}

function snapshot(): RuntimeConfigurationView {
  return { swarmId: 3, run: 2, revision: 7, configuration, budget, requests: [] };
}
function mount() {
  render(
    <MemoryRouter initialEntries={["/s/3/config"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/config" element={<ConfigPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
}

it("shows worker cards and live usage, with saved diagnostics available on demand", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let current = snapshot();
  api.on("GET", "/api/swarms/3/config", () => current);
  api.on("GET", "/api/swarms/3", () => detail({ budget: current.budget }));
  mount();
  act(() => source().open());
  expect(await screen.findByText("provider-a/model-a · thinking: high")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Swarm configuration" })).toBeInTheDocument();
  expect(screen.getByText("$10.5000 spent")).toBeVisible();
  const summary = screen.getByText("Run configuration", { exact: false, selector: "summary" });
  expect(summary.parentElement).not.toHaveAttribute("open");
  await userEvent.click(summary);
  expect(screen.getByText("Changed on resume: budget")).toBeVisible();
  current = { ...current, budget: { ...budget, costUsd: 11 } };
  act(() =>
    source().emit({
      ...eventBase,
      type: "usage.updated",
      payload: {
        agent: "Maria",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 11, turns: 1 },
      },
    }),
  );
  expect(await screen.findByText("$11.0000 spent")).toBeVisible();
});

it("refreshes usage metrics without refetching config or disturbing budget drafts", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms/3/config", () => snapshot());
  mount();
  act(() => source().open());
  const money = await screen.findByRole("textbox", { name: "New money ceiling, USD" });
  await waitFor(() => expect(money).toBeEnabled());
  await userEvent.type(money, "1");
  let finishRefresh: (value: ReturnType<typeof detail>) => void = () => {};
  api.on(
    "GET",
    "/api/swarms/3",
    () =>
      new Promise<ReturnType<typeof detail>>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const initialReads = api.callsTo("GET", "/api/swarms/3").length;
  const configReads = api.callsTo("GET", "/api/swarms/3/config").length;
  act(() =>
    source().emit({
      ...eventBase,
      type: "usage.updated",
      payload: { agent: "Maria", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 11, turns: 1 } },
    }),
  );
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3")).toHaveLength(initialReads + 1));
  expect(api.callsTo("GET", "/api/swarms/3/config")).toHaveLength(configReads);
  expect(money).toBeEnabled();
  expect(money).toHaveFocus();
  await userEvent.keyboard("5");
  expect(money).toHaveValue("15");
  act(() => finishRefresh(detail({ budget: { ...budget, costUsd: 11 } })));
  expect(await screen.findByText("$11.0000 spent")).toBeVisible();
  expect(money).toHaveFocus();
  expect(money).toHaveValue("15");
});

it("labels missing historical configuration and accounting honestly", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms/3/config", () => ({ ...snapshot(), configuration: null, budget: null }));
  mount();
  expect(await screen.findByText(/No configuration was recorded/)).toBeInTheDocument();
  expect(screen.getByText("No budget accounting was recorded for this run.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add workers" })).toBeDisabled();
});

it("surfaces a configuration load failure", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms/3/config", () =>
    jsonResponse(500, { error: "internal", message: "Snapshot unavailable" }),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load configuration: Snapshot unavailable");
});

it("submits revision-bound add, remove and budget requests and renders effective results", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  const maria = configuration.effective.workers[0];
  let current = {
    ...snapshot(),
    configuration: {
      ...configuration,
      effective: { ...configuration.effective, workers: [maria, { ...maria, name: "John" }] },
    },
  };
  let operation = 0;
  api.on("GET", "/api/swarms/3/config", () => current);
  api.on("POST", "/api/swarms/3/config", () => {
    operation++;
    const change: ConfigurationChange =
      operation === 1
        ? { type: "addAgents", count: 2 }
        : operation === 2
          ? { type: "removeAgent", name: "John" }
          : { type: "raiseBudget", moneyUsd: 20 };
    let workers = current.configuration.effective.workers;
    if (operation === 1) workers = [...workers, { ...maria, name: "Thomas" }, { ...maria, name: "Jane" }];
    if (operation === 2) workers = workers.filter((worker) => worker.name !== "John");
    const policy =
      operation === 3
        ? { ...current.configuration.effective.budget, moneyUsd: 20 }
        : current.configuration.effective.budget;
    current = {
      ...current,
      revision: current.revision + 1,
      configuration: {
        ...current.configuration,
        effective: { ...current.configuration.effective, workers, budget: policy },
      },
      requests: [
        ...current.requests,
        {
          id: operation,
          swarmId: 3,
          run: 2,
          expectedRevision: current.revision,
          change,
          requestedBy: "User",
          status: "applied",
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
      ],
    };
    return current;
  });
  mount();
  const count = await screen.findByRole("textbox", { name: "Workers to add" });
  await userEvent.clear(count);
  await userEvent.type(count, "2");
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(await screen.findByRole("button", { name: "Remove Thomas" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove John" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Remove John" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove John" })).not.toBeInTheDocument());
  await userEvent.type(screen.getByRole("textbox", { name: "New money ceiling, USD" }), "20");
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(await screen.findByText("#3 Update budget ceilings:")).toHaveTextContent("applied");
  expect(api.callsTo("POST", "/api/swarms/3/config").map((call) => call.body)).toEqual([
    { expectedRun: 2, expectedRevision: 7, change: { type: "addAgents", count: 2 } },
    { expectedRun: 2, expectedRevision: 8, change: { type: "removeAgent", name: "John" } },
    { expectedRun: 2, expectedRevision: 9, change: { type: "raiseBudget", moneyUsd: 20 } },
  ]);
});

it("tracks a queued worker addition through startup without replaying the write", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let current = snapshot();
  api.on("GET", "/api/swarms/3/config", () => current);
  api.on("POST", "/api/swarms/3/config", () => {
    current = {
      ...current,
      requests: [
        {
          id: 1,
          swarmId: 3,
          run: 2,
          expectedRevision: 7,
          change: { type: "addAgents", count: 1 },
          requestedBy: "User",
          status: "pending",
          error: null,
          createdAt: 1,
          finishedAt: null,
        },
      ],
    };
    return current;
  });
  mount();
  const add = await screen.findByRole("button", { name: "Add workers" });
  await waitFor(() => expect(add).toBeEnabled());
  await userEvent.click(add);
  expect(await screen.findByText(/Queued. New workers wait/)).toBeVisible();
  expect(add).toBeDisabled();
  current = { ...current, requests: current.requests.map((request) => ({ ...request, status: "applying" })) };
  act(() => source().emit({ ...eventBase, type: "swarm.updated", payload: { swarm: detail().swarm } }));
  expect(await screen.findByText(/Applying. The runtime is updating/)).toBeVisible();
  expect(add).toBeDisabled();
  current = {
    ...current,
    revision: 8,
    configuration: {
      ...configuration,
      effective: {
        ...configuration.effective,
        workers: [...configuration.effective.workers, { ...configuration.effective.workers[0], name: "John" }],
      },
    },
    requests: current.requests.map((request) => ({ ...request, status: "applied", finishedAt: 2 })),
  };
  act(() => source().emit({ ...eventBase, type: "swarm.updated", payload: { swarm: detail().swarm } }));
  expect(await screen.findByText(/Added to the roster. New workers may still be starting/)).toBeVisible();
  await waitFor(() => expect(add).toBeEnabled());
  expect(screen.getByRole("button", { name: "Remove John" })).toBeEnabled();
  expect(api.callsTo("POST", "/api/swarms/3/config")).toHaveLength(1);
});

it("keeps old-run control history visible without blocking the current run", async () => {
  installFakeEventSource();
  const api = installFakeApi();
  const current: RuntimeConfigurationView = {
    ...snapshot(),
    requests: [
      {
        id: 1,
        swarmId: 3,
        run: 1,
        expectedRevision: 0,
        change: { type: "addAgents", count: 1 },
        requestedBy: "User",
        status: "applying",
        error: null,
        createdAt: 1,
        finishedAt: null,
      },
    ],
  };
  api.on("GET", "/api/swarms/3/config", () => current);
  mount();
  expect(await screen.findByText("#1 Add 1 workers:")).toHaveTextContent("applying");
  expect(screen.getByText("Run 1 · requested by User")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Add workers" })).toBeEnabled());
});

it("shows pending and rejected status from the runtime without replaying writes", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let current: RuntimeConfigurationView = {
    ...snapshot(),
    requests: [
      {
        id: 1,
        swarmId: 3,
        run: 2,
        expectedRevision: 7,
        change: { type: "addAgents", count: 1 },
        requestedBy: "User",
        status: "pending",
        error: null,
        createdAt: 1,
        finishedAt: null,
      },
    ],
  };
  api.on("GET", "/api/swarms/3/config", () => current);
  mount();
  const history = await screen.findByRole("list", { name: "Configuration change requests" });
  expect(within(history).getByText("pending")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Queued. New workers wait");
  expect(screen.getByRole("button", { name: "Add workers" })).toBeDisabled();
  current = { ...current, requests: current.requests.map((request) => ({ ...request, status: "applying" })) };
  act(() => source().emit({ ...eventBase, type: "swarm.updated", payload: { swarm: detail().swarm } }));
  expect(await within(history).findByText("applying")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Applying. The runtime is updating");
  expect(screen.getByRole("button", { name: "Add workers" })).toBeDisabled();
  current = {
    ...current,
    requests: current.requests.map((request) => ({
      ...request,
      status: "rejected",
      error: "Model is unavailable; no worker was added.",
      finishedAt: 2,
    })),
  };
  act(() => source().emit({ ...eventBase, type: "swarm.updated", payload: { swarm: detail().swarm } }));
  expect(await screen.findByText("Model is unavailable; no worker was added.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
  await waitFor(() => expect(screen.getByRole("button", { name: "Add workers" })).toBeEnabled());
  expect(api.callsTo("POST", "/api/swarms/3/config")).toHaveLength(0);
});

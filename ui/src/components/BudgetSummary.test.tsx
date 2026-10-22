import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { BudgetStatus } from "../../../src/budget";
import { BudgetSummary } from "./BudgetSummary";
import { SwarmStreamProvider } from "../api/SwarmStream";
import { useSwarmDetail } from "../pages/agents/useSwarmDetail";
import { detail, eventBase } from "../pages/agents/testFixtures";
import { installFakeApi } from "../test/fakeApi";
import { installFakeEventSource } from "../test/fakeEventSource";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function LiveBudget() {
  const snapshot = useSwarmDetail("3");
  return <BudgetSummary budget={snapshot.data?.swarm.budget} />;
}

const budget: BudgetStatus = {
  moneyUsd: 10,
  timeSeconds: 300,
  costUsd: 10.5,
  activeTimeMs: 301000,
  gracefulShutdown: false,
  exhausted: "money",
  stopReason: "budget-exhausted",
  moneyOvershootUsd: 0.5,
  timeOvershootSeconds: 1,
  accounting: "Worker and Watcher usage only; Main excluded. Delayed accounting may overshoot.",
};

it("shows cumulative consumption, exhaustion, overshoot and immediate shutdown", async () => {
  render(<BudgetSummary budget={budget} />);
  await userEvent.click(screen.getByRole("button", { name: "Budget exhausted: money" }));
  expect(screen.getByText("Reported spend: $10.5000 USD / $10 USD")).toBeInTheDocument();
  expect(screen.getByText("Active execution: 301.0 seconds / 300 seconds")).toBeInTheDocument();
  expect(screen.getByText("Stop reason: budget-exhausted")).toBeInTheDocument();
  expect(screen.getByText("Overshoot: $0.5000 USD · 1.0 seconds")).toBeInTheDocument();
  expect(screen.getByText("Shutdown policy: interrupt immediately")).toBeInTheDocument();
  expect(screen.getByText(budget.accounting)).toBeInTheDocument();
});

it("shows graceful policy and unlimited dimensions honestly", async () => {
  render(
    <BudgetSummary
      budget={{
        ...budget,
        moneyUsd: null,
        timeSeconds: null,
        exhausted: null,
        stopReason: null,
        gracefulShutdown: true,
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Budget accounting" }));
  expect(screen.getByText("Reported spend: $10.5000 USD / unlimited")).toBeInTheDocument();
  expect(screen.getByText("Shutdown policy: finish active pi turn without admitting new work")).toBeInTheDocument();
});

it("does not fabricate accounting for historical records", () => {
  const { container } = render(<BudgetSummary budget={null} />);
  expect(container).toBeEmptyDOMElement();
});

it("refreshes cumulative accounting when reported usage changes", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let snapshot = detail({ budget: { ...budget, exhausted: null, stopReason: null, costUsd: 1 } });
  api.on("GET", "/api/swarms/3", () => snapshot);
  render(
    <SwarmStreamProvider swarmId="3">
      <LiveBudget />
    </SwarmStreamProvider>,
  );
  act(() => source().open());
  await userEvent.click(await screen.findByRole("button", { name: "Budget accounting" }));
  expect(screen.getByText("Reported spend: $1.0000 USD / $10 USD")).toBeInTheDocument();
  snapshot = detail({ budget });
  act(() =>
    source().emit({
      ...eventBase,
      type: "usage.updated",
      payload: {
        agent: "Maria",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 10.5, turns: 1 },
      },
    }),
  );
  expect(await screen.findByText("Reported spend: $10.5000 USD / $10 USD")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Budget exhausted: money" })).toBeInTheDocument();
});

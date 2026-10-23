import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { UsageCostBreakdown } from "../../../../src/api-types";
import { agentStats, statsTotals } from "../../test/statsFixture";
import { AgentStatsTable } from "./AgentStatsTable";
import { StatTiles } from "./StatTiles";

const complete: UsageCostBreakdown = {
  records: 3,
  input: { usd: 0.6, knownRecords: 3 },
  output: { usd: 0.4, knownRecords: 3 },
  cacheRead: { usd: 0.03, knownRecords: 3 },
  cacheWrite: { usd: 0.2, knownRecords: 3 },
};

it("groups summary metrics and four token/cost categories with cache totals at the top", () => {
  render(<StatTiles totals={{ ...statsTotals, cacheWrite: 600, costBreakdown: complete }} />);
  const region = screen.getByRole("region", { name: "Swarm usage totals" });
  expect(region.querySelectorAll("dl")).toHaveLength(2);
  for (const list of region.querySelectorAll("dl")) expect(list.children).toHaveLength(4);
  for (const label of ["Input tokens", "Output tokens", "Cache read tokens", "Cache write tokens"]) {
    expect(within(region).getByText(label, { selector: "dt" })).toBeInTheDocument();
  }
  expect(screen.getByText("Cache tokens")).toHaveTextContent("5.6k");
  expect(screen.getByLabelText(/Input cost: \$0\.60/)).toHaveTextContent("$0.60 recorded cost");
  expect(screen.getByLabelText(/Cache read cost: \$0\.03/)).toHaveTextContent("$0.03 recorded cost");
  expect(screen.getByLabelText(/Cache write cost: \$0\.20/)).toHaveTextContent("$0.20 recorded cost");
  expect(screen.queryByText(/Some per-type costs were not recorded/)).not.toBeInTheDocument();
});

it("distinguishes partial subtotals, recorded zero and unrecorded categories", () => {
  const partial: UsageCostBreakdown = {
    records: 3,
    input: { usd: 0.2, knownRecords: 1 },
    output: { usd: null, knownRecords: 0 },
    cacheRead: { usd: 0, knownRecords: 1 },
    cacheWrite: { usd: 0.000003, knownRecords: 2 },
  };
  render(<StatTiles totals={{ ...statsTotals, costBreakdown: partial }} />);
  expect(screen.getByLabelText(/Input cost: \$0\.20; known subtotal/)).toHaveTextContent("known subtotal");
  expect(screen.getByLabelText("Output cost not recorded")).toHaveTextContent("Cost not recorded");
  expect(screen.getByLabelText(/Cache read cost: \$0\.00; known subtotal/)).toHaveAttribute(
    "title",
    "Recorded for 1 of 3 usage records",
  );
  expect(screen.getByLabelText(/Cache write cost: \$0\.000003/)).toHaveTextContent("$0.000003 known subtotal");
  expect(screen.getByText(/missing costs are not treated as zero/)).toBeInTheDocument();
  expect(screen.getByText("Cost", { selector: "dt" }).nextElementSibling).toHaveTextContent("$1.23");
});

it("keeps historical missing category costs honest instead of assigning today's prices", () => {
  render(<StatTiles totals={statsTotals} />);
  expect(screen.getAllByText("Cost not recorded")).toHaveLength(4);
  expect(screen.getByText("Cost", { selector: "dt" }).nextElementSibling).toHaveTextContent("$1.23");
});

it("shows separate cache token and cost cells for workers and the pinned total row", () => {
  const totals = { ...statsTotals, input: 100, output: 50, cacheRead: 20, cacheWrite: 10, costBreakdown: complete };
  const agent = agentStats("Liam", {
    input: 100,
    output: 50,
    cacheRead: 20,
    cacheWrite: 10,
    cost: 1.23,
    turns: 3,
    costBreakdown: complete,
  });
  render(<AgentStatsTable agents={[agent]} totals={totals} />);
  const row = screen.getByRole("rowheader", { name: "Liam" }).closest("tr");
  const total = screen.getByRole("rowheader", { name: "Total" }).closest("tr");
  if (!row || !total) throw new Error("Expected agent and total rows");
  for (const item of [row, total]) {
    expect(within(item).getByText("20")).toBeInTheDocument();
    expect(within(item).getByText("10")).toBeInTheDocument();
    expect(within(item).getByLabelText(/Cache read cost: \$0\.03/)).toHaveTextContent("$0.03");
    expect(within(item).getByLabelText(/Cache write cost: \$0\.20/)).toHaveTextContent("$0.20");
  }
  expect(screen.getByRole("columnheader", { name: "Cache read tokens" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Cache write tokens" })).toBeInTheDocument();
});

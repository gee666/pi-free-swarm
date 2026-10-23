import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmViewProvider } from "../api/SwarmView";
import { useSwarmDetail } from "../pages/agents/useSwarmDetail";
import { detail, eventBase } from "../pages/agents/testFixtures";
import { installFakeApi } from "../test/fakeApi";
import { installFakeEventSource } from "../test/fakeEventSource";
import { AcceptanceSummary } from "./AcceptanceSummary";

function Summary() {
  const snapshot = useSwarmDetail("3");
  return snapshot.data && <AcceptanceSummary detail={snapshot.data} />;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves retired reasons as explicitly excluded history without changing active counts", async () => {
  const api = installFakeApi();
  const snapshot = detail();
  snapshot.acceptance = {
    ...snapshot.acceptance,
    totalAgents: 2,
    threshold: 2,
    counts: { accepted: 1, incomplete: 0, blocked: 0 },
    votes: [{ agent: "John", run: 1, verdict: "accepted", reason: "Current verification", updatedAt: 1 }],
    excludedVotes: [
      { agent: "Maria", run: 1, verdict: "blocked", reason: "Retired historical objection", updatedAt: 1 },
      { agent: "Maria", run: 2, verdict: "accepted", reason: "Older retired verification", updatedAt: 2 },
    ],
  };
  api.on("GET", "/api/swarms/3/acceptance/history", () => ({
    votes: snapshot.acceptance.excludedVotes ?? [],
    next: null,
    complete: true,
    scanned: 2,
  }));
  render(<AcceptanceSummary detail={snapshot} />);
  expect(api.callsTo("GET", "/api/swarms/3/acceptance/history")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Task acceptance: unchecked" }));
  expect(screen.getByRole("heading", { name: "Archived votes, not counted" })).toBeInTheDocument();
  expect(await screen.findByText("Retired historical objection")).toBeInTheDocument();
  expect(screen.getByText("Older retired verification")).toBeInTheDocument();
  expect(screen.getByText("Accepted: 1 · Incomplete: 0 · Blocked: 0")).toBeInTheDocument();
  expect(screen.getByText("Quorum: 2 of 2 agents")).toBeInTheDocument();
});

it("separates finished execution from acceptance and refreshes vote counts and reasons on events", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let snapshot = detail({ status: "finished" });
  api.on("GET", "/api/swarms/3", () => snapshot);
  api.on("GET", "/api/swarms/3/acceptance/history", () => ({ votes: [], next: null, complete: true, scanned: 0 }));
  render(
    <SwarmViewProvider swarmId="3">
      <Summary />
    </SwarmViewProvider>,
  );
  act(() => source().open());
  const pill = await screen.findByRole("button", { name: "Task acceptance: unchecked" });
  expect(pill).toHaveTextContent("verdict: unchecked");
  expect(screen.queryByText(/Execution:/)).not.toBeInTheDocument();
  await userEvent.click(pill);
  expect(await screen.findByText(/Execution: finished · Task verdict: unchecked/)).toBeInTheDocument();
  expect(screen.getByText("Quorum: 3 of 3 agents")).toBeInTheDocument();
  expect(screen.getByText("No votes recorded.")).toBeInTheDocument();
  expect(screen.getByText("OAuth login works.")).toBeInTheDocument();
  snapshot = {
    ...snapshot,
    acceptance: {
      ...snapshot.acceptance,
      verdict: "accepted",
      revision: 3,
      counts: { accepted: 3, incomplete: 0, blocked: 0 },
      votes: ["Maria", "John", "Liam"].map((agent) => ({
        agent,
        run: 1,
        verdict: "accepted",
        reason: `${agent} checked OAuth login.`,
        updatedAt: 1,
      })),
    },
  };
  act(() => source().emit({ ...eventBase, type: "acceptance.updated", payload: { revision: 3 } }));
  expect(await screen.findByText(/Task verdict: accepted \(agent-attested\)/)).toBeInTheDocument();
  expect(screen.getByText("Accepted: 3 · Incomplete: 0 · Blocked: 0")).toBeInTheDocument();
  expect(screen.getByText("Maria checked OAuth login.")).toBeInTheDocument();
  expect(screen.queryByText("No votes recorded.")).not.toBeInTheDocument();
  snapshot = {
    ...snapshot,
    acceptance: {
      ...snapshot.acceptance,
      verdict: "incomplete",
      revision: 4,
      counts: { accepted: 2, incomplete: 0, blocked: 1 },
      votes: snapshot.acceptance.votes.map((vote) =>
        vote.agent === "Maria" ? { ...vote, verdict: "blocked", reason: "OAuth provider unavailable." } : vote,
      ),
    },
  };
  act(() => source().emit({ ...eventBase, type: "acceptance.updated", payload: { revision: 4 } }));
  expect(await screen.findByText("OAuth provider unavailable.")).toBeInTheDocument();
  expect(screen.getByText("Accepted: 2 · Incomplete: 0 · Blocked: 1")).toBeInTheDocument();
  expect(screen.queryByText("Maria checked OAuth login.")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("OAuth provider unavailable.")).not.toBeInTheDocument();
  expect(pill).toHaveAttribute("aria-expanded", "false");
  expect(pill).toHaveFocus();
  expect(api.callsTo("GET", "/api/swarms/3/acceptance/history")).toHaveLength(1);
});

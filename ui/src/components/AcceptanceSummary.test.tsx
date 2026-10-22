import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmStreamProvider } from "../api/SwarmStream";
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

it("separates finished execution from acceptance and refreshes vote counts and reasons on events", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  let snapshot = detail({ status: "finished" });
  api.on("GET", "/api/swarms/3", () => snapshot);
  render(
    <SwarmStreamProvider swarmId="3">
      <Summary />
    </SwarmStreamProvider>,
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
});

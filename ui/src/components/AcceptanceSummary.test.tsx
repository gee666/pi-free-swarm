import { act, render, screen } from "@testing-library/react";
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

it("separates finished execution from agent-attested acceptance and refreshes evidence on events", async () => {
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
  expect(await screen.findByText(/Execution: finished · Task verdict: unchecked/)).toBeInTheDocument();
  snapshot = {
    ...snapshot,
    acceptance: {
      ...snapshot.acceptance,
      verdict: "accepted",
      revision: 1,
      evidence: [
        { reference: "test report", result: "passed", command: "npm test", cwd: "/project", fingerprint: "supplied" },
      ],
    },
  };
  act(() => source().emit({ ...eventBase, type: "acceptance.updated", payload: { revision: 1 } }));
  expect(await screen.findByText(/Task verdict: accepted \(agent-attested\)/)).toBeInTheDocument();
  expect(screen.getByText("test report: passed")).toBeInTheDocument();
  expect(screen.getByText(/Supplied fingerprint \(not verified\)/)).toBeInTheDocument();
  snapshot = {
    ...snapshot,
    acceptance: {
      ...snapshot.acceptance,
      verdict: "incomplete",
      revision: 2,
      knownGaps: ["Missing browser check"],
      findings: ["Check the sign-in flow"],
    },
  };
  act(() => source().emit({ ...eventBase, type: "acceptance.updated", payload: { revision: 2 } }));
  expect(await screen.findByText("Missing browser check")).toBeInTheDocument();
  expect(screen.getByText("Check the sign-in flow")).toBeInTheDocument();
});

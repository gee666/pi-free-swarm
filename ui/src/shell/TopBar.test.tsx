import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RunHeaderState } from "../../../src/api-types";
import { swarm } from "../pages/agents/testFixtures";
import { TopBar } from "./TopBar";

it.each([
  ["running", "Running"],
  ["awaiting_user", "Awaiting you"],
  ["completed", "Completed"],
  ["stopped_with_blockers", "Stopped with blockers"],
  ["stopped", "Stopped"],
  ["interrupted", "Interrupted"],
] satisfies [RunHeaderState, string][])("uses the run vocabulary for %s", (state, label) => {
  render(
    <MemoryRouter>
      <TopBar swarms={[swarm]} current={swarm} runState={state} onSelectSwarm={() => undefined} />
    </MemoryRouter>,
  );
  expect(screen.getByText(label, { selector: 'span[aria-hidden="true"]' })).toBeInTheDocument();
});

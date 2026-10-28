import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RunHeaderState } from "../../../src/api-types";
import { swarm } from "../pages/agents/testFixtures";
import { TopBar } from "./TopBar";

it("keeps the current name when the swarm index has not loaded", () => {
  render(
    <MemoryRouter>
      <TopBar swarms={[]} current={swarm} onSelectSwarm={() => undefined} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: `${swarm.name} · #${swarm.id}` })).toBeInTheDocument();
});

it("uses the route id rather than the picker placeholder before either snapshot arrives", () => {
  render(
    <MemoryRouter>
      <TopBar swarms={[]} currentId={3} onSelectSwarm={() => undefined} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Swarm · #3" })).toBeInTheDocument();
  expect(screen.queryByText("Select a swarm")).not.toBeInTheDocument();
});

it.each([
  ["running", "Running"],
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

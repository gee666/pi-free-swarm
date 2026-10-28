import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipantList } from "../pages/agents/ParticipantList";
import { agent } from "../pages/agents/testFixtures";
import { WorkAgentList } from "../pages/work/WorkAgentList";
import { configuration } from "../test/runConfigurationFixture";

const retired = agent("Maria", 1, { status: "retired", model: configuration.effective.workers[0] });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("labels retired workers without hiding their selectable participant detail", async () => {
  const selected = vi.fn();
  render(<ParticipantList participants={[retired]} error={undefined} selected={undefined} onSelect={selected} />);
  expect(screen.getByText("retired")).toBeInTheDocument();
  expect(screen.getByText("Retired")).toBeInTheDocument();
  expect(screen.getByText("provider-a/model-a · thinking: high")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Maria" }));
  expect(selected).toHaveBeenCalledWith("Maria");
});

it("keeps retired work history available with an explicit retired label", () => {
  render(<WorkAgentList agents={[retired]} selected="Maria" onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Maria" })).toBeInTheDocument();
  expect(screen.getByText("Retired")).toBeInTheDocument();
  expect(screen.getAllByText("retired")).toHaveLength(2);
});

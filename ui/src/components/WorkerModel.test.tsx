import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ParticipantList } from "../pages/agents/ParticipantList";
import { agent } from "../pages/agents/testFixtures";
import { WorkAgentList } from "../pages/work/WorkAgentList";

const maria = agent("Maria", 1, {
  model: { name: "Maria", provider: "provider-a", modelId: "model-a", thinkingLevel: "high" },
});

it("places effective model metadata under the worker name in the participant list", () => {
  render(<ParticipantList participants={[maria]} error={undefined} selected="Maria" onSelect={() => {}} />);
  const label = screen.getByText("provider-a/model-a · thinking: high");
  expect(label.closest("[data-agent-row]")).toHaveTextContent("Maria");
});

it("keeps model metadata and current activity visible together in the work list", () => {
  render(
    <WorkAgentList
      agents={[{ ...maria, activity: { kind: "tool", toolName: "read" } }]}
      selected="Maria"
      onSelect={() => {}}
    />,
  );
  const row = screen.getByText("provider-a/model-a · thinking: high").closest("[data-agent-row]");
  expect(row).toHaveTextContent("read");
});

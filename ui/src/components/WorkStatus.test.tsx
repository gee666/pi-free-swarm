import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StatusGlyph, statusLabels, type WorkStatus } from "./StatusGlyph";
import { StatusPill } from "./StatusPill";
import { VoteBadge } from "./VoteBadge";

describe("work status vocabulary", () => {
  const states: WorkStatus[] = [
    "unlinked",
    "incomplete",
    "satisfied",
    "blocked",
    "new",
    "claimed",
    "in_progress",
    "review",
    "accepted",
  ];
  it.each(states)("labels and describes the %s glyph", async (status) => {
    render(<StatusGlyph status={status} />);
    const glyph = screen.getByRole("img", { name: statusLabels[status] });
    await userEvent.hover(glyph);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(statusLabels[status]);
  });
  it("uses the waiting glyph without losing a dependency-specific label", () => {
    render(<StatusGlyph status="claimed" waiting label="Waiting on #12" />);
    expect(screen.getByRole("img", { name: "Waiting on #12" }).querySelector("svg")).toHaveClass("lucide-hourglass");
  });
  it("shows contextual status pills and keeps all vote counts muted", () => {
    render(
      <>
        <StatusPill status="blocked" label="Blocked · awaiting you" />
        <VoteBadge current={2} required={4} />
        <VoteBadge current={4} required={4} />
      </>,
    );
    expect(screen.getByText("Blocked · awaiting you")).toBeInTheDocument();
    expect(screen.getByLabelText("votes 2/4").className).toMatch(/badge/);
    expect(screen.getByLabelText("votes 4/4")).toHaveClass(screen.getByLabelText("votes 2/4").className);
  });
});

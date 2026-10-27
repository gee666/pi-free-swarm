import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TabRail } from "./TabRail";

function rail(messages: number, comments: number) {
  return (
    <MemoryRouter>
      <TabRail basePath="/s/3" unread={{ messages, comments }} />
    </MemoryRouter>
  );
}

describe("User unread tab badges", () => {
  it("keeps direct messages and subscribed comments on their own tabs", () => {
    render(rail(3, 7));
    expect(screen.getByRole("link", { name: "Agents 3 unread messages" })).toHaveAttribute("href", "/s/3/agents");
    expect(screen.getByRole("link", { name: "Wall 7 unread comments" })).toHaveAttribute("href", "/s/3/wall");
    expect(screen.getByRole("link", { name: "Config" })).toHaveAttribute("href", "/s/3/config");
    expect(screen.getByRole("link", { name: "Watcher" })).toHaveAttribute("href", "/s/3/watcher");
  });

  it("updates authoritative totals, hides zeros and keeps exact accessible counts above the visual badge cap", () => {
    const view = render(rail(127, 2));
    expect(screen.getByRole("link", { name: "Agents 127 unread messages" })).toHaveTextContent("9+");
    view.rerender(rail(0, 0));
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wall" })).toBeInTheDocument();
    expect(screen.queryByText(/unread messages/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unread comments/)).not.toBeInTheDocument();
  });

  it("does not badge criteria while retaining unread message counts", () => {
    render(
      <MemoryRouter>
        <TabRail basePath="/s/3" unread={{ messages: 5, comments: 0 }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Criteria" })).toHaveAttribute("href", "/s/3/criteria");
    expect(screen.getByRole("link", { name: "Agents 5 unread messages" })).toBeInTheDocument();
  });

  it("keeps legacy detail responses without summary metadata usable", () => {
    render(
      <MemoryRouter>
        <TabRail basePath="/s/4" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/s/4/agents");
  });
});

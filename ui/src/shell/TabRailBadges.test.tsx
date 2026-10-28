import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { TabRail } from "./TabRail";

it("shows Wall attention without an Agents inbox badge", () => {
  const view = render(
    <MemoryRouter>
      <TabRail basePath="/s/3" unread={{ messages: 9, comments: 3 }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Wall 3 unread updates" })).toHaveAttribute("href", "/s/3/wall");
  expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/s/3/agents");
  view.rerender(
    <MemoryRouter>
      <TabRail basePath="/s/3" unread={{ messages: 0, comments: 127 }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Wall 127 unread updates" })).toHaveTextContent("9+");
  view.rerender(
    <MemoryRouter>
      <TabRail basePath="/s/3" unread={{ messages: 0, comments: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Wall" })).toBeInTheDocument();
});

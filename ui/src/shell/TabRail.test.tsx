import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { TabRail } from "./TabRail";

it("links Config to the current swarm and retains every existing section", async () => {
  render(
    <MemoryRouter initialEntries={["/s/7/agents"]}>
      <TabRail basePath="/s/7" />
    </MemoryRouter>,
  );
  const config = screen.getByRole("link", { name: "Config" });
  expect(config).toHaveAttribute("href", "/s/7/config");
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Agents",
    "Wall",
    "Work",
    "Watcher",
    "Stats",
    "Config",
  ]);
  expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(config);
  expect(config).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Agents" })).not.toHaveAttribute("aria-current");
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { agentDestination, type AgentAction } from "../lib/agentNavigation";
import { AgentName } from "./AgentName";
import { ListRow } from "./ListRow";

function Location() {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function mount(name = "Maria", path = "/s/3/wall", children = <AgentName name={name} />) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/s/:id/:section/:name?"
          element={
            <>
              {children}
              <Location />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentName", () => {
  it.each([
    ["work", "Open work"],
    ["stats", "Show stats"],
  ] satisfies ReadonlyArray<[AgentAction, string]>)("navigates to %s for the named agent", async (action, label) => {
    const name = "Zoë & A";
    mount(name);
    await userEvent.click(screen.getByRole("button", { name: `${label}: ${name}` }));
    expect(screen.getByLabelText("Location")).toHaveTextContent(agentDestination("3", name, action));
  });

  it("shows explanatory tooltips on keyboard focus and hover", async () => {
    mount();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Open work: Maria");
    await userEvent.hover(screen.getByRole("button", { name: "Show stats: Maria" }));
    expect(await screen.findByText("Show stats: Maria", { selector: '[role="tooltip"]' })).toBeInTheDocument();
  });

  it.each(["User", "You", "Main", "System", "user"])("shows no actions for %s", (name) => {
    mount(name);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders outside the app router for isolated component previews", () => {
    render(<AgentName name="Maria" />);
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    ["/s/3/work/Maria", "Open work: Maria"],
    ["/s/3/stats?agent=maria", "Show stats: Maria"],
  ])("hides the current agent action on %s", (path, label) => {
    mount("Maria", path);
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps another agent's work action available", () => {
    mount("Maria", "/s/3/work/John");
    expect(screen.getByRole("button", { name: "Open work: Maria" })).toBeInTheDocument();
  });

  it("does not select or expand a row when an action is clicked", async () => {
    const select = vi.fn();
    const { container } = mount(
      "Maria",
      "/s/3/wall",
      <>
        <ListRow avatar="Maria" title={<AgentName name="Maria" />} onSelect={select} />
      </>,
    );
    expect(container.querySelector("button button")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show stats: Maria" }));
    expect(select).not.toHaveBeenCalled();
  });

  it("preserves keyboard activation of the row itself", async () => {
    const select = vi.fn();
    mount("Maria", "/s/3/wall", <ListRow avatar="Maria" title={<AgentName name="Maria" />} onSelect={select} />);
    const row = screen.getByRole("button", { name: "Maria" });
    expect(within(row).queryByRole("button")).toBeNull();
    row.focus();
    await userEvent.keyboard("{Enter} ");
    expect(select).toHaveBeenCalledTimes(2);
  });
});

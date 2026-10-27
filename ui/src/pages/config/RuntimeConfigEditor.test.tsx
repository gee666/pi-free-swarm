import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { budget, configuration } from "../../test/runConfigurationFixture";
import { RuntimeConfigEditor } from "./RuntimeConfigEditor";

function fixture() {
  const actions = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onRaiseBudget: vi.fn().mockResolvedValue(undefined),
  };
  const workers = [
    { name: "Maria", model: configuration.effective.workers[0] },
    { name: "John", model: null },
  ];
  return { actions, workers, budget: configuration.effective.budget, maxAgents: 5 };
}

it("requests worker additions and explains retained votes and required task handoffs", async () => {
  const { actions, ...props } = fixture();
  render(<RuntimeConfigEditor {...props} {...actions} />);
  expect(
    screen.getByText(
      /Removing a worker keeps its votes; tasks it owns must be handed off before their criteria can be agreed/,
    ),
  ).toBeInTheDocument();
  const count = screen.getByRole("textbox", { name: "Workers to add" });
  await userEvent.clear(count);
  await userEvent.type(count, "2");
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(actions.onAdd).toHaveBeenCalledWith(2);
  expect(await screen.findByRole("status")).toHaveTextContent("Change requested");
  await userEvent.click(screen.getByRole("button", { name: "Remove John" }));
  expect(actions.onRemove).toHaveBeenCalledWith("John");
});

it("saves only entered cumulative ceilings without resetting consumption", async () => {
  const { actions, ...props } = fixture();
  render(<RuntimeConfigEditor {...props} {...actions} />);
  expect(screen.getByText(/Usage is not reset/)).toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: "New money ceiling, USD" }), "20");
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(actions.onRaiseBudget).toHaveBeenCalledWith({ moneyUsd: 20 });
  expect(screen.getByRole("textbox", { name: "New money ceiling, USD" })).toHaveValue("");
});

it("allows lower ceilings including below usage without resetting accounting", async () => {
  const { actions, ...props } = fixture();
  render(<RuntimeConfigEditor {...props} {...actions} accounting={{ ...budget, costUsd: 8, activeTimeMs: 120000 }} />);
  await userEvent.type(screen.getByRole("textbox", { name: "New money ceiling, USD" }), "5");
  await userEvent.type(screen.getByRole("textbox", { name: "New active-time ceiling, seconds" }), "60");
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(actions.onRaiseBudget).toHaveBeenCalledWith({ moneyUsd: 5, timeSeconds: 60 });
  expect(screen.getByText(/Usage is not reset/)).toBeInTheDocument();
});

it("rejects malformed counts and nonpositive or empty ceiling edits locally", async () => {
  const { actions, ...props } = fixture();
  render(<RuntimeConfigEditor {...props} {...actions} />);
  const count = screen.getByRole("textbox", { name: "Workers to add" });
  await userEvent.clear(count);
  await userEvent.type(count, "-1");
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("positive integer");
  expect(actions.onAdd).not.toHaveBeenCalled();
  await userEvent.clear(count);
  await userEvent.type(count, "4");
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("recorded maximum of 5");
  expect(actions.onAdd).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter at least one budget ceiling");
  await userEvent.type(screen.getByRole("textbox", { name: "New money ceiling, USD" }), "0");
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("finite positive total ceiling");
  expect(actions.onRaiseBudget).not.toHaveBeenCalled();
});

it("allows finite ceilings on an unlimited budget but protects the last worker", async () => {
  const { actions, workers } = fixture();
  render(
    <RuntimeConfigEditor
      workers={workers.slice(0, 1)}
      budget={{ moneyUsd: null, timeSeconds: null, gracefulShutdown: false }}
      {...actions}
    />,
  );
  expect(screen.getByRole("button", { name: "Remove Maria" })).toBeDisabled();
  const money = screen.getByRole("textbox", { name: "New money ceiling, USD" });
  const time = screen.getByRole("textbox", { name: "New active-time ceiling, seconds" });
  expect(money).toBeEnabled();
  expect(time).toBeEnabled();
  await userEvent.type(money, "5");
  await userEvent.type(time, "60");
  await userEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  expect(actions.onRaiseBudget).toHaveBeenCalledWith({ moneyUsd: 5, timeSeconds: 60 });
});

it("keeps a failed request visible without claiming the edit was applied", async () => {
  const { actions, ...props } = fixture();
  actions.onAdd.mockRejectedValue(new Error("Configuration revision changed. Reload before trying again."));
  render(<RuntimeConfigEditor {...props} {...actions} />);
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Configuration revision changed");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("prevents overlapping edits while an operation is pending", async () => {
  const { actions, ...props } = fixture();
  let release = () => {};
  actions.onAdd.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  render(<RuntimeConfigEditor {...props} {...actions} />);
  await userEvent.click(screen.getByRole("button", { name: "Add workers" }));
  expect(screen.getByRole("button", { name: "Remove John" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save budgets" })).toBeDisabled();
  act(() => release());
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove John" })).toBeEnabled());
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { WATCHER_NAME } from "../../../../src/constants";
import { ParticipantList } from "./ParticipantList";
import { agent, detail } from "./testFixtures";

it("pins User first and Watcher second regardless of activity order", () => {
  const user = detail().participants.find((participant) => participant.kind === "user");
  if (!user) throw new Error("Missing user fixture");
  const participants = [
    agent("Maria", 2, { lastActivityAt: 400 }),
    agent("John", 1, { lastActivityAt: 300 }),
    agent(WATCHER_NAME, 3, { lastActivityAt: 200 }),
    { ...user, lastActivityAt: 100 },
  ];
  const view = render(
    <ParticipantList participants={participants} error={undefined} selected="User" onSelect={() => undefined} />,
  );
  const names = () =>
    within(screen.getByRole("region", { name: "Agents" }))
      .getAllByRole("button")
      .map((row) => row.getAttribute("aria-label"));
  expect(names()).toEqual(["User", WATCHER_NAME, "Maria", "John"]);
  expect(participants.map(({ name }) => name)).toEqual(["Maria", "John", WATCHER_NAME, "User"]);
  view.rerender(
    <ParticipantList
      participants={[participants[1], participants[0], participants[3], participants[2]]}
      error={undefined}
      selected="User"
      onSelect={() => undefined}
    />,
  );
  expect(names()).toEqual(["User", WATCHER_NAME, "John", "Maria"]);
  expect(screen.queryByRole("heading", { name: "Agents" })).not.toBeInTheDocument();
});

it("keeps retired workers without replacement evidence readable and selectable", async () => {
  const selected: string[] = [];
  render(
    <ParticipantList
      participants={[agent("Former", 1, { status: "retired" }), agent("Current", 2)]}
      error={undefined}
      selected={undefined}
      onSelect={(name) => selected.push(name)}
    />,
  );
  const former = screen.getByRole("button", { name: "Former" });
  const formerRow = former.closest("[data-agent-row]");
  const currentRow = screen.getByRole("button", { name: "Current" }).closest("[data-agent-row]");
  if (!(formerRow instanceof HTMLElement) || !(currentRow instanceof HTMLElement)) throw new Error("Missing rows");
  expect(within(formerRow).getByText("retired", { exact: true })).toBeInTheDocument();
  expect(within(formerRow).getByText("Retired", { exact: true })).toBeInTheDocument();
  expect(formerRow).not.toHaveTextContent("undefined");
  expect(within(currentRow).queryByText(/retired/i)).not.toBeInTheDocument();
  await userEvent.click(former);
  expect(selected).toEqual(["Former"]);
});

it("shows the recorded successor beside a retired worker without changing selection identity", async () => {
  const selected: string[] = [];
  render(
    <ParticipantList
      participants={[
        agent("Sigfrid", 1, { status: "retired", successorName: "Alcibiades" }),
        agent("Alcibiades", 2, { successorName: null }),
      ]}
      error={undefined}
      selected="Sigfrid"
      onSelect={(name) => selected.push(name)}
    />,
  );
  const retired = screen.getByRole("button", { name: "Sigfrid" });
  const row = retired.closest("[data-agent-row]");
  if (!(row instanceof HTMLElement)) throw new Error("Missing retired row");
  expect(within(row).getByText("retired → Alcibiades", { exact: true })).toBeInTheDocument();
  expect(within(row).getByTitle("Retired, replaced by Alcibiades")).toBeInTheDocument();
  expect(within(row).getByText("Retired, replaced by Alcibiades", { exact: true })).toBeInTheDocument();
  expect(retired).toHaveAttribute("aria-current", "true");
  await userEvent.click(retired);
  expect(selected).toEqual(["Sigfrid"]);
});

import { render, screen, within } from "@testing-library/react";
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

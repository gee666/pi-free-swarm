import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { criterion, renderWork, task, workApi } from "../work-items/testFixtures";
import { CriteriaPage } from "./CriteriaPage";

let api: FakeApi;
let source: () => FakeEventSource;
beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
  workApi(api);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = () => renderWork("/s/3/criteria/12", "/s/:id/criteria/:criterionId?", <CriteriaPage />, source);

it("shows skeletons instead of empty sections while the first detail is pending", () => {
  api.on("GET", "/api/swarms/3/criteria/12", () => new Promise(() => undefined));
  open();
  expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
  expect(screen.queryByText("No linked tasks")).not.toBeInTheDocument();
});

it("keeps forms out of the detail until requested and hides empty discussions", async () => {
  open();
  await screen.findByRole("heading", { name: "Rank matches" });
  expect(screen.queryByRole("heading", { name: "Your vote" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Blocker" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Discussions" })).not.toBeInTheDocument();
  expect(screen.getByText("No linked tasks")).toBeInTheDocument();
  expect(screen.getByText("No votes yet")).toBeInTheDocument();
  const header = screen.getByRole("button", { name: "Vote" }).closest("header");
  if (!header) throw new Error("Detail header missing");
  expect(within(header).getAllByRole("button")).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "Vote" }));
  expect(screen.getByRole("heading", { name: "Your vote" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("heading", { name: "Your vote" })).not.toBeInTheDocument();
});

it("expands one-line vote reasons and keeps contributions in row tooltips", async () => {
  const reason = "Checked the complete acceptance evidence";
  api.on("GET", "/api/swarms/3/criteria/12", () =>
    criterion({
      tasks: [{ ...task(), contribution: "Covers query ranking" }],
      votes: [
        {
          criterionId: 12,
          voter: "Bob",
          verdict: "covered",
          reason,
          role: "independent",
          stale: true,
          criterionRevision: 2,
          linksSignature: "",
          blockerRevision: null,
          createdAt: 1,
        },
      ],
    }),
  );
  open();
  await screen.findByRole("heading", { name: "Rank matches" });
  const row = screen.getByRole("button", { name: /Bob independent Covered/ });
  expect(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByText(reason)).toHaveLength(2);
  expect(screen.getByTitle("Covers query ranking")).toHaveTextContent("Add ranking index");
  expect(screen.queryByText("Covers query ranking")).not.toBeInTheDocument();
});

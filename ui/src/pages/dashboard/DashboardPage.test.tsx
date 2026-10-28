import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../api/dashboard";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { FilePreviewProvider } from "../../components/FilePreview";
import { installDialogFixture } from "../../test/dialogFixture";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { criterion } from "../work-items/testFixtures";
import { DashboardPage } from "./DashboardPage";
import { agent, eventBase } from "../agents/testFixtures";
import { dashboardFixture } from "./testFixture";

let api: FakeApi;
let source: () => FakeEventSource;
let restoreDialog: () => void;
beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
  restoreDialog = installDialogFixture();
});
afterEach(() => {
  cleanup();
  restoreDialog();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  render(
    <MemoryRouter initialEntries={["/s/3/dashboard"]}>
      <SwarmStreamProvider swarmId="3">
        <DashboardProvider swarmId="3">
          <FilePreviewProvider swarmId="3">
            <Routes>
              <Route path="/s/:id/dashboard" element={<DashboardPage />} />
            </Routes>
          </FilePreviewProvider>
        </DashboardProvider>
      </SwarmStreamProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
}

it("renders four gates, linked intent, numbers, coverage, and recent activity", async () => {
  const data = dashboardFixture();
  data.gates[1].detail = "Active criteria without linked tasks.";
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(await screen.findByRole("heading", { name: "Running" })).toBeInTheDocument();
  const rules = screen.getByRole("heading", { name: "Stop rules" }).closest("section");
  if (!rules) throw new Error("Stop rules missing");
  expect(within(rules).getAllByRole("link")).toHaveLength(4);
  expect(within(rules).getByText("3 unlinked")).toBeInTheDocument();
  expect(within(rules).getByText("14 open, 2 deferred")).toBeInTheDocument();
  expect(within(rules).getByRole("link", { name: /Every criterion linked/ })).toHaveAttribute(
    "href",
    "/s/3/criteria?status=unlinked",
  );
  expect(within(rules).getByRole("link", { name: /No pending reviews/ })).toHaveAttribute(
    "href",
    "/s/3/tasks?status=review",
  );
  expect(screen.getByText("rev 3 · by Ann")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Original request" })).toHaveAttribute("title", "Preview brief.md");
  expect(screen.getByText("18/42")).toBeInTheDocument();
  const bar = screen.getByRole("img", { name: "Search: 7 satisfied, 1 blocked, 1 incomplete, 0 unlinked" });
  expect(bar.children).toHaveLength(3);
  expect(bar.children[0]).toHaveStyle({ width: `${(7 / 9) * 100}%` });
  expect(screen.getByRole("link", { name: "Main 0/4" })).toHaveAttribute("href", "/s/3/criteria?group=Main");
  expect(screen.getByRole("link", { name: "#34" })).toHaveAttribute("href", "/s/3/tasks/34");
  await userEvent.hover(screen.getByText("Unknown"));
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Needs 30 min of run time and 5 accepted tasks in the last hour",
  );
});

it("shows agreed blockers and unread Wall updates without requiring attention", async () => {
  const data = dashboardFixture();
  data.attention.agreedBlockers = [criterion({ status: "blocked", title: "Missing credentials" })];
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(await screen.findByText("Worth a look")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reject" })).toHaveAttribute("href", "/s/3/criteria/12");
  expect(screen.getByText("2 unread Wall updates")).toBeInTheDocument();
});

it("makes optional participation clear when there is nothing to inspect", async () => {
  const data = dashboardFixture();
  data.attention.unreadUserUpdates = 0;
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(
    await screen.findByText("Nothing needs your attention — the swarm is working on its own."),
  ).toBeInTheDocument();
});

it("debounces project, task and criterion events into one live refetch", async () => {
  let data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  await screen.findByText("18/42");
  data = { ...data, counts: { ...data.counts, satisfied: 19 } };
  act(() => {
    for (const type of ["project.changed", "task.changed", "criterion.changed"] satisfies (
      "project.changed" | "task.changed" | "criterion.changed"
    )[]) {
      source().emit({ id: 1, swarmId: 3, type, payload: { id: 3 }, createdAt: Date.now() });
    }
  });
  expect(await screen.findByText("19/42")).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(2);
});

it("debounces participant updates before refreshing derived gates", async () => {
  let data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  await screen.findByText("18/42");
  data = { ...data, counts: { ...data.counts, satisfied: 17 } };
  act(() => {
    for (let i = 0; i < 3; i++)
      source().emit({
        ...eventBase,
        type: "participant.updated",
        payload: { participant: agent("John", 1, { status: "crashed" }) },
      });
  });
  expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(1);
  expect(await screen.findByText("17/42")).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(2);
});

it("shows a retryable failure then the empty intent and coverage states", async () => {
  api.on("GET", "/api/swarms/3/dashboard", () => jsonResponse(500, { error: "internal", message: "Offline" }));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  const data = dashboardFixture();
  data.project.intentSummary = null;
  data.criteriaCoverage = [];
  data.recentActivity = [];
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Intent not recorded yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See open tasks" })).toHaveAttribute("href", "/s/3/tasks");
  expect(screen.getByText("No criteria yet")).toBeInTheDocument();
  expect(screen.getByText("No activity yet")).toBeInTheDocument();
});

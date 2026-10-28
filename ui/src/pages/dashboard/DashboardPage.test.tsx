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

it("renders donuts, hourly pace, linked intent, four gates and compact activity", async () => {
  const data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(await screen.findByRole("heading", { name: "Running" })).toBeInTheDocument();
  expect(screen.getByText(/Run 2 · 14 agents/)).toHaveTextContent("$1,525");
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
  expect(screen.getByRole("link", { name: "Intent" })).toHaveAttribute("title", "Preview intent.md");
  expect(screen.getByRole("link", { name: "Brief" })).toHaveAttribute("title", "Preview brief.md");
  expect(
    screen.getByRole("img", { name: /Tasks: 61 done, 2 in review, 8 in progress, 26 not started/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /Criteria: 18 satisfied, 1 blocked, 20 incomplete, 3 unlinked/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Tasks legend" })).toHaveTextContent("Done6163%");
  expect(screen.getByText("3 waiting on dependencies · 5 ready to start")).toBeInTheDocument();
  expect(screen.getByText("9 need votes")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Accepted per hour, UTC/ }).querySelectorAll("rect")).toHaveLength(12);
  expect(screen.getByRole("link", { name: "Main 0/4" })).toHaveAttribute("href", "/s/3/criteria?group=Main");
  expect(screen.getByRole("link", { name: "#34" })).toHaveAttribute("href", "/s/3/tasks/34");
  await userEvent.hover(screen.getByText("ETA unknown"));
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Needs 30 min of run time and 5 accepted tasks in the last hour",
  );
});

it("links only unread User mentions and agreed blockers from one attention line", async () => {
  const data = dashboardFixture();
  data.attention.agreedBlockers = [criterion({ status: "blocked", title: "Missing credentials" })];
  data.attention.unreadUserUpdates = 20;
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(await screen.findByRole("link", { name: "2 mentions" })).toHaveAttribute("href", "/s/3/wall");
  expect(screen.getByRole("link", { name: "1 agreed blocker" })).toHaveAttribute(
    "href",
    "/s/3/criteria?status=blocked",
  );
  expect(screen.queryByText(/20 mentions/)).not.toBeInTheDocument();
  expect(screen.queryByText("Worth a look")).not.toBeInTheDocument();
});

it("omits the attention line when nothing needs the user", async () => {
  const data = dashboardFixture();
  data.attention.userMentions = 0;
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  await screen.findByRole("heading", { name: "Running" });
  expect(screen.queryByRole("link", { name: /mention|blocker/ })).not.toBeInTheDocument();
});

it("sorts groups by completion, expands after ten and limits activity to fifteen", async () => {
  const data = dashboardFixture();
  data.criteriaCoverage = Array.from({ length: 12 }, (_, index) => ({
    group: `Group ${index}`,
    satisfied: index,
    total: 12,
    blocked: 0,
    incomplete: 12 - index,
    unlinked: 0,
  })).reverse();
  const entry = data.recentActivity[0];
  if (!entry) throw new Error("Activity fixture missing");
  data.recentActivity = Array.from({ length: 16 }, (_, index) => ({ ...entry, id: String(index) }));
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  const show = await screen.findByRole("button", { name: "Show all (12)" });
  const groups = screen.getAllByRole("link", { name: /Group/ });
  expect(groups).toHaveLength(10);
  expect(groups[0]).toHaveTextContent("Group 0");
  expect(screen.getAllByRole("link", { name: "#34" })).toHaveLength(15);
  await userEvent.click(show);
  expect(screen.getAllByRole("link", { name: /Group/ })).toHaveLength(12);
  expect(show).not.toBeInTheDocument();
});

it("debounces project, task and criterion events into one live refetch", async () => {
  let data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  await screen.findByRole("img", { name: /Criteria: 18 satisfied/ });
  data = { ...data, counts: { ...data.counts, satisfied: 19 } };
  act(() => {
    for (const type of ["project.changed", "task.changed", "criterion.changed"] satisfies (
      "project.changed" | "task.changed" | "criterion.changed"
    )[])
      source().emit({ id: 1, swarmId: 3, type, payload: { id: 3 }, createdAt: Date.now() });
  });
  expect(await screen.findByRole("img", { name: /Criteria: 19 satisfied/ })).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(2);
});

it("debounces participant updates before refreshing derived gates", async () => {
  let data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  await screen.findByRole("img", { name: /Criteria: 18 satisfied/ });
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
  expect(await screen.findByRole("img", { name: /Criteria: 17 satisfied/ })).toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(2);
});

it("shows skeletons on the first request, then a retryable error and empty data", async () => {
  api.on("GET", "/api/swarms/3/dashboard", () => jsonResponse(500, { error: "internal", message: "Offline" }));
  mount();
  expect(screen.queryByText("No criteria yet")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  const data = dashboardFixture();
  data.project.intentSummary = null;
  data.criteriaCoverage = [];
  data.recentActivity = [];
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Intent not recorded yet")).toBeInTheDocument();
  expect(screen.getByText("No criteria yet")).toBeInTheDocument();
  expect(screen.getByText("No activity yet")).toBeInTheDocument();
});

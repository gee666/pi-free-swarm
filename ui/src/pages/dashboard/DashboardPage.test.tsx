import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../api/dashboard";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { FilePreviewProvider } from "../../components/FilePreview";
import { installDialogFixture } from "../../test/dialogFixture";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
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

it("renders five gates, linked intent, numbers, coverage, and recent activity", async () => {
  const data = dashboardFixture();
  data.gates[0].ok = true;
  data.gates[1].detail = "Active criteria without linked tasks.";
  data.attention.scopeApprovalNeeded = false;
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  mount();
  expect(await screen.findByRole("heading", { name: "Awaiting you" })).toBeInTheDocument();
  const rules = screen.getByRole("heading", { name: "Stop rules" }).closest("section");
  if (!rules) throw new Error("Stop rules missing");
  expect(within(rules).getByText("Scope approved")).toBeInTheDocument();
  expect(within(rules).getAllByRole("link")).toHaveLength(4);
  expect(within(rules).getByText("3 unlinked")).toBeInTheDocument();
  expect(within(rules).getByText("14 open, 2 deferred")).toBeInTheDocument();
  expect(within(rules).getByText("rev 7 approved")).toBeInTheDocument();
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

it("approves the exact scope revision and refetches after success", async () => {
  let data = dashboardFixture();
  api.on("GET", "/api/swarms/3/dashboard", () => data);
  api.on("POST", "/api/swarms/3/scope/approve", () => {
    data = { ...data, attention: { ...data.attention, scopeApprovalNeeded: false } };
    return data.project;
  });
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Approve scope" }));
  const dialog = screen.getByRole("dialog", { name: "Approve scope rev 7" });
  expect(within(dialog).getByText("42 active criteria in 2 groups")).toBeInTheDocument();
  expect(within(dialog).getByText("Later changes to the intent or criteria need approval again.")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(api.callsTo("POST", "/api/swarms/3/scope/approve")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Approve scope" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.callsTo("POST", "/api/swarms/3/scope/approve")[0]?.body).toEqual({ expectedRevision: 7 });
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/dashboard")).toHaveLength(2));
});

it("keeps a failed approval open with an error", async () => {
  api.on("GET", "/api/swarms/3/dashboard", dashboardFixture);
  api.on("POST", "/api/swarms/3/scope/approve", () =>
    jsonResponse(409, { error: "validation", message: "Scope changed" }),
  );
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Approve scope" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Scope changed");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
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

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskEvent } from "../../../../src/api-types";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { agent, eventBase } from "../agents/testFixtures";
import { page, renderWork, task, workApi } from "../work-items/testFixtures";
import { TasksPage } from "./TasksPage";

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
const open = (path = "/s/3/tasks/34") => renderWork(path, "/s/:id/tasks/:taskId?", <TasksPage />, source);

it("does not expose peer-review actions while a review subagent runs", async () => {
  api.on("GET", "/api/swarms/3/tasks/34", () => task({ status: "review", validActions: ["edit"] }));
  open();
  await screen.findByRole("heading", { name: "Add ranking index" });
  for (const name of ["Accept", "Request changes", "Request review"])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});

it("shows the contribution counter and long-text notice without truncating the input", async () => {
  open("/s/3/tasks/new");
  await userEvent.click(screen.getByRole("button", { name: "Add criterion" }));
  await userEvent.click(await screen.findByRole("option", { name: "#12 Rank matches" }));
  const contribution = screen.getByRole("textbox", { name: "Contribution to #12" });
  await userEvent.type(contribution, "x".repeat(201));
  expect(screen.getByText("201/200")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Over 200 characters, the full text is saved to a file");
  expect(contribution).toHaveValue("x".repeat(201));
});

it("hides empty dependency sections but keeps the evidence empty state", async () => {
  open();
  await screen.findByRole("heading", { name: "Add ranking index" });
  expect(screen.queryByRole("heading", { name: "Depends on" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Blocks" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Evidence" })).toBeInTheDocument();
  expect(screen.getByText("No evidence yet")).toBeInTheDocument();
});

it.each(["", '{"reviewer":"Jonah"}'])(
  "renders review requests as authored actions without raw metadata %s",
  async (body) => {
    const event: TaskEvent = {
      id: 1,
      swarmId: 3,
      taskId: 34,
      actor: "Ada",
      kind: "review_requested",
      body,
      evidence: "Checked the tests",
      createdAt: 1,
    };
    api.on("GET", "/api/swarms/3/tasks/34", () => task({ timeline: [event] }));
    open();
    const timeline = await screen.findByRole("list", { name: "Task timeline" });
    const row = await within(timeline).findByRole("listitem");
    expect(row).toHaveTextContent("Ada started a review subagent");
    expect(within(row).getByText("Checked the tests")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("review_requested");
    expect(row).not.toHaveTextContent('{"reviewer"');
  },
);

it("debounces participant updates and refreshes both task list and detail", async () => {
  open();
  await screen.findByRole("heading", { name: "Add ranking index" });
  const listBefore = api.callsTo("GET", "/api/swarms/3/tasks").length;
  const detailBefore = api.callsTo("GET", "/api/swarms/3/tasks/34").length;
  api.on("GET", "/api/swarms/3/tasks", () => page([task({ owner: "John" })]));
  api.on("GET", "/api/swarms/3/tasks/34", () =>
    task({ owner: "John", validActions: ["handoff"], handoffTargets: ["Maria"] }),
  );
  act(() => {
    for (let i = 0; i < 3; i++)
      source().emit({
        ...eventBase,
        type: "participant.updated",
        payload: { participant: agent("John", 1, { status: "crashed" }) },
      });
  });
  expect(api.callsTo("GET", "/api/swarms/3/tasks")).toHaveLength(listBefore);
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks")).toHaveLength(listBefore + 1));
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks/34")).toHaveLength(detailBefore + 1));
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(screen.getByRole("option", { name: "Hand off…" }));
  expect(screen.getByRole("option", { name: "Maria" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "John" })).not.toBeInTheDocument();
});

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetailResponse } from "../../../../src/api-types";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { eventBase } from "../agents/testFixtures";
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

describe("Task work board", () => {
  it("preserves task edits across live updates and reloads revision conflicts explicitly", async () => {
    let value = task();
    api.on("GET", "/api/swarms/3/tasks/34", () => value);
    api.on("POST", "/api/swarms/3/tasks/34/edit", () => jsonResponse(409, { error: "validation", message: "Changed" }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const description = screen.getByRole("textbox", { name: "Description" });
    await userEvent.clear(description);
    await userEvent.type(description, "My pending edit");
    value = task({ revision: 7, body: "Someone else's edit" });
    const before = api.callsTo("GET", "/api/swarms/3/tasks/34").length;
    act(() => source().emit({ ...eventBase, type: "task.changed", payload: { id: 34 } }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks/34")).toHaveLength(before + 1));
    expect(description).toHaveValue("My pending edit");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Changed by someone else — reload");
    expect(api.callsTo("POST", "/api/swarms/3/tasks/34/edit")[0]?.body).toMatchObject({
      expectedRevision: 6,
      fields: { body: "My pending edit" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Someone else's edit"),
    );
  });
  it("defaults to open tasks and applies owner, criterion and derived filters", async () => {
    open("/s/3/tasks?criterion=12");
    await screen.findByText("Add ranking index");
    expect(api.callsTo("GET", "/api/swarms/3/tasks").at(-1)?.query.get("status")).toBe(
      "new,claimed,in_progress,review",
    );
    expect(api.callsTo("GET", "/api/swarms/3/tasks").at(-1)?.query.get("criterionId")).toBe("12");
    await userEvent.click(screen.getByRole("button", { name: "Owner: Anyone" }));
    await userEvent.click(screen.getByRole("option", { name: "Me" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks").at(-1)?.query.get("owner")).toBe("User"));
    await userEvent.click(screen.getByRole("button", { name: "Status: Open" }));
    await userEvent.click(screen.getByRole("option", { name: "Waiting" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks").at(-1)?.query.get("waiting")).toBe("true"));
    await userEvent.click(screen.getByRole("button", { name: "Criterion: #12" }));
    await userEvent.click(screen.getByRole("option", { name: "All" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks").at(-1)?.query.has("criterionId")).toBe(false));
  });
  const cases: {
    status: TaskDetailResponse["status"];
    validActions: TaskDetailResponse["validActions"];
    buttons: string[];
    absent: string[];
  }[] = [
    {
      status: "new",
      validActions: ["claim", "edit"],
      buttons: ["Claim"],
      absent: ["Start", "Release", "Accept", "Reopen"],
    },
    {
      status: "claimed",
      validActions: ["start", "release", "edit"],
      buttons: ["Start"],
      absent: ["Claim", "Accept", "Reopen"],
    },
    {
      status: "in_progress",
      validActions: ["release", "edit"],
      buttons: [],
      absent: ["Claim", "Start", "Accept"],
    },
    {
      status: "review",
      validActions: ["edit"],
      buttons: [],
      absent: ["Claim", "Start", "Release", "Accept", "Request changes", "Request review"],
    },
    {
      status: "accepted",
      validActions: ["reopen", "edit"],
      buttons: ["Reopen"],
      absent: ["Claim", "Start", "Accept", "Release"],
    },
  ];
  it.each(cases)(
    "shows one primary $status action and moves release into More",
    async ({ status, validActions, buttons, absent }) => {
      api.on("GET", "/api/swarms/3/tasks/34", () => task({ status, validActions }));
      open();
      await screen.findByRole("heading", { name: "Add ranking index" });
      expect(screen.queryByRole("list", { name: "Task lifecycle" })).not.toBeInTheDocument();
      expect(
        within(screen.getByRole("region", { name: "Task" })).getByText(
          status === "review"
            ? "In review"
            : status === "in_progress"
              ? "In progress"
              : status[0].toUpperCase() + status.slice(1),
        ),
      ).toBeInTheDocument();
      for (const label of buttons) expect(screen.getByRole("button", { name: label })).toBeEnabled();
      for (const label of absent) expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
      if (validActions.includes("release")) {
        await userEvent.click(screen.getByRole("button", { name: "More" }));
        expect(screen.getByRole("option", { name: "Release" })).toBeInTheDocument();
      }
    },
  );
  it("shows waiting dependencies and disables Start with its explanation", async () => {
    api.on("GET", "/api/swarms/3/tasks/34", () =>
      task({
        status: "claimed",
        owner: "User",
        waiting: true,
        runnable: false,
        waitsOn: [12, 13],
        validActions: ["release", "edit"],
      }),
    );
    open();
    const start = await screen.findByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    expect(screen.getByText(/Waiting on #12, #13/)).toBeInTheDocument();
    await userEvent.hover(start.parentElement ?? start);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Waiting on #12, #13");
  });
  it.each([
    {
      status: "accepted",
      action: "reopen",
      label: "Reopen",
      field: "Reason",
      body: { reason: "Verified test/output.txt" },
      validActions: ["reopen"],
    },
  ] satisfies {
    status: TaskDetailResponse["status"];
    action: string;
    label: string;
    field: string;
    body: object;
    validActions: TaskDetailResponse["validActions"];
  }[])("submits the inline $label form", async ({ status, action, label, field, body, validActions }) => {
    api.on("GET", "/api/swarms/3/tasks/34", () => task({ status, validActions }));
    api.on("POST", `/api/swarms/3/tasks/34/${action}`, () => task());
    open();
    await userEvent.click(await screen.findByRole("button", { name: label }));
    await userEvent.type(screen.getByRole("textbox", { name: field }), "Verified test/output.txt");
    const forms = screen.getAllByRole("button", { name: label });
    await userEvent.click(forms[forms.length - 1]);
    await waitFor(() =>
      expect(api.callsTo("POST", `/api/swarms/3/tasks/34/${action}`)[0]?.body).toEqual({
        expectedRevision: 6,
        ...body,
      }),
    );
  });
  it("claims and hands work off through the API-provided target picker", async () => {
    api.on("GET", "/api/swarms/3/tasks/34", () =>
      task({ validActions: ["claim", "handoff"], handoffTargets: ["Jonah"] }),
    );
    api.on("POST", "/api/swarms/3/tasks/34/claim", () => task());
    api.on("POST", "/api/swarms/3/tasks/34/handoff", () => task());
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/tasks/34/claim")[0]?.body).toEqual({ expectedRevision: 6 }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("option", { name: "Hand off…" }));
    expect(screen.queryByRole("option", { name: "John" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Jonah" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/tasks/34/handoff")[0]?.body).toEqual({
        expectedRevision: 6,
        to: "Jonah",
      }),
    );
  });
  it("creates tasks with a criterion contribution, dependency and self-claim", async () => {
    const dependency = task({ id: 9, title: "Prepare data" });
    api.on("GET", "/api/swarms/3/tasks", () => page([dependency]));
    api.on("POST", "/api/swarms/3/tasks", () => task());
    open("/s/3/tasks/new");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Implement ranking");
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Build it");
    await userEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    await userEvent.click(await screen.findByRole("option", { name: "#12 Rank matches" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Contribution to #12" }), "Indexes results");
    await userEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    await userEvent.click(await screen.findByRole("option", { name: "#9 Prepare data" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Claim it myself" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/tasks")[0]?.body).toEqual({
        title: "Implement ranking",
        body: "Build it",
        criteria: [{ criterionId: 12, contribution: "Indexes results" }],
        dependsOn: [9],
        claim: true,
      }),
    );
  });
  it("appends timeline pages and refreshes changed task details", async () => {
    const first = {
      id: 1,
      swarmId: 3,
      taskId: 34,
      actor: "Ann",
      kind: "created",
      body: "First entry",
      evidence: "",
      createdAt: 1,
    } satisfies TaskDetailResponse["timeline"][number];
    api.on("GET", "/api/swarms/3/tasks/34", ({ query }) =>
      task({
        timeline: query.has("after") ? [{ ...first, id: 2, body: "Later entry" }] : [first],
        nextAfter: query.has("after") ? null : 1,
      }),
    );
    open();
    await screen.findByText("First entry");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Later entry")).toBeInTheDocument();
    expect(screen.getByText("First entry")).toBeInTheDocument();
    const before = api.callsTo("GET", "/api/swarms/3/tasks/34").length;
    act(() => source().emit({ ...eventBase, type: "task.changed", payload: { id: 34 } }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/tasks/34")).toHaveLength(before + 1));
  });
});

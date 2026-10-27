import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { eventBase } from "../agents/testFixtures";
import { criterion, page, renderWork, task, workApi } from "../work-items/testFixtures";
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
const open = (path = "/s/3/criteria") => renderWork(path, "/s/:id/criteria/:criterionId?", <CriteriaPage />, source);
const list = () => screen.getByRole("region", { name: "Criteria" });
const calls = () => api.callsTo("GET", "/api/swarms/3/criteria");

describe("Criteria work board", () => {
  it("operates status menus from the keyboard", async () => {
    open();
    await within(list()).findByText("Rank matches");
    const status = screen.getByRole("button", { name: "Status" });
    status.focus();
    await userEvent.keyboard("{Enter}{ArrowDown}{Enter}");
    await waitFor(() => expect(calls().at(-1)?.query.get("status")).toBe("unlinked"));
  });
  it("keeps global group coverage across cursor pages and shows search notes", async () => {
    api.on("GET", "/api/swarms/3/criteria/groups", () => ({
      groups: [{ group: "Search", satisfied: 3, blocked: 0, incomplete: 4, unlinked: 0, total: 7 }],
    }));
    api.on("GET", "/api/swarms/3/criteria", ({ query }) =>
      page(query.has("cursor") ? [criterion({ id: 13, title: "Next criterion" })] : [criterion()], {
        nextCursor: query.has("cursor") ? null : "next",
        notes: ["Lexical search only"],
      }),
    );
    open();
    await within(list()).findByText("3/7");
    expect(screen.getByText("Lexical search only")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await within(list()).findByText("Next criterion");
    expect(within(list()).getByText("Rank matches")).toBeInTheDocument();
    expect(within(list()).getByText("3/7")).toBeInTheDocument();
    expect(calls().at(-1)?.query.get("cursor")).toBe("next");
  });
  it("records a blocker with all four required fields", async () => {
    api.on("POST", "/api/swarms/3/criteria/12/block", () => ({}));
    open("/s/3/criteria/12");
    const record = await screen.findByRole("button", { name: "Record blocker" });
    const section = record.closest("section");
    if (!section) throw new Error("Missing blocker section");
    await userEvent.click(record);
    for (const label of ["Reason", "Missing", "Attempted", "Would unblock"])
      await userEvent.type(within(section).getByRole("textbox", { name: label }), label);
    await userEvent.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/criteria/12/block")[0]?.body).toEqual({
        expectedRevision: 0,
        reason: "Reason",
        missing: "Missing",
        attempted: "Attempted",
        unblock: "Would unblock",
      }),
    );
  });
  it("preselects dashboard filters, groups rows and removes filter pills", async () => {
    open("/s/3/criteria?status=blocked&group=Search");
    await within(list()).findByText("Rank matches");
    expect(calls().at(-1)?.query.get("status")).toBe("blocked");
    expect(calls().at(-1)?.query.get("group")).toBe("Search");
    expect(within(list()).getByText("0/1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Search" }));
    await waitFor(() => expect(calls().at(-1)?.query.has("group")).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "Needs my vote" }));
    await waitFor(() => expect(calls().at(-1)?.query.get("needsMyVote")).toBe("true"));
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));
    await waitFor(() => expect(calls().at(-1)?.query.get("includeArchived")).toBe("true"));
  });
  it("debounces searches and keeps ranked order instead of grouping", async () => {
    const second = criterion({ id: 13, group: "Main", title: "Second ranked match" });
    api.on("GET", "/api/swarms/3/criteria", ({ query }) =>
      query.get("query") ? page([second, criterion()]) : page([criterion()]),
    );
    open();
    await within(list()).findByText("Rank matches");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Search criteria" }), "ranking");
    expect(calls().at(-1)?.query.get("query")).toBe("");
    await waitFor(() => expect(calls().at(-1)?.query.get("query")).toBe("ranking"));
    await screen.findByText("Second ranked match");
    expect(
      within(list())
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("data-row"))
        .map((button) => button.textContent),
    ).toEqual([expect.stringContaining("Second ranked match"), expect.stringContaining("Rank matches")]);
    expect(within(list()).queryByText("0/1")).not.toBeInTheDocument();
  });
  it("shows stale votes and missing owners, and enforces vote prerequisites", async () => {
    const value = criterion({
      votes: [
        {
          criterionId: 12,
          voter: "Bob",
          verdict: "satisfied",
          reason: "Verified old work",
          role: "independent",
          stale: true,
          criterionRevision: 2,
          linksSignature: "",
          blockerRevision: null,
          createdAt: 1,
        },
      ],
    });
    api.on("GET", "/api/swarms/3/criteria/12", () => value);
    api.on("POST", "/api/swarms/3/criteria/12/vote", () => ({}));
    open("/s/3/criteria/12");
    await screen.findByRole("heading", { name: "Your vote" });
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("Waiting for Ann (owner)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Satisfied" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Blocked" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "Still needs work");
    await userEvent.click(screen.getByRole("button", { name: "Vote" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/criteria/12/vote")[0]?.body).toEqual({
        expectedRevision: 3,
        verdict: "incomplete",
        reason: "Still needs work",
      }),
    );
  });
  it("permits satisfied votes only after linked tasks are accepted", async () => {
    api.on("GET", "/api/swarms/3/criteria/12", () =>
      criterion({ tasks: [{ ...task({ status: "accepted" }), contribution: "Ranks work" }] }),
    );
    open("/s/3/criteria/12");
    expect(await screen.findByRole("radio", { name: "Satisfied" })).toBeEnabled();
  });
  it.each([
    ["Accept exception", "approve"],
    ["Reject", "reject"],
  ])("confirms %s with the blocker revision", async (label, decision) => {
    api.on("GET", "/api/swarms/3/criteria/12", () =>
      criterion({
        exceptionPending: true,
        blocker: {
          criterionId: 12,
          revision: 4,
          reason: "Unavailable",
          missing: "Token",
          attempted: "Requested token",
          unblock: "Provide token",
          author: "Ann",
          updatedAt: 1,
          approvedRevision: null,
          rejectedRevision: null,
          decidedAt: null,
        },
        agreement: { current: 2, required: 2, label: "2/2" },
      }),
    );
    api.on("POST", "/api/swarms/3/criteria/12/blocker-decision", () => ({}));
    open("/s/3/criteria/12");
    await userEvent.click(await screen.findByRole("button", { name: label }));
    expect(api.callsTo("POST", "/api/swarms/3/criteria/12/blocker-decision")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/swarms/3/criteria/12/blocker-decision")[0]?.body).toEqual({
        expectedRevision: 4,
        decision,
      }),
    );
  });
  it("saves long requirements, sends expectedRevision and reloads conflicts", async () => {
    let value = criterion();
    api.on("GET", "/api/swarms/3/criteria/12", () => value);
    api.on("POST", "/api/swarms/3/criteria/12/edit", () =>
      jsonResponse(409, { error: "validation", message: "Revision changed" }),
    );
    open("/s/3/criteria/12");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const user = userEvent.setup();
    const requirement = screen.getByRole("textbox", { name: "Requirement" });
    await user.clear(requirement);
    await user.click(requirement);
    await user.paste("x".repeat(201));
    expect(screen.getByText("Over 200 characters, the full text is saved to a file")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Changed by someone else — reload")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/swarms/3/criteria/12/edit")[0]?.body).toMatchObject({
      expectedRevision: 3,
      fields: { body: "x".repeat(201) },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    value = criterion({ revision: 4, body: "Concurrent edit" });
    const before = api.callsTo("GET", "/api/swarms/3/criteria/12").length;
    act(() => source().emit({ ...eventBase, type: "criterion.changed", payload: { id: 12 } }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/criteria/12")).toHaveLength(before + 1));
    expect(requirement).toHaveValue("x".repeat(201));
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Requirement" })).toHaveValue("Concurrent edit"));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("creates a criterion and refreshes affected details after live changes", async () => {
    api.on("POST", "/api/swarms/3/criteria", () => criterion());
    open("/s/3/criteria/new");
    await userEvent.type(screen.getByRole("combobox", { name: "Group" }), "Search");
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "New criterion");
    await userEvent.type(screen.getByRole("textbox", { name: "Requirement" }), "Must rank results");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Rank matches" });
    expect(api.callsTo("POST", "/api/swarms/3/criteria")[0]?.body).toMatchObject({
      group: "Search",
      title: "New criterion",
      body: "Must rank results",
    });
    const before = api.callsTo("GET", "/api/swarms/3/criteria/12").length;
    act(() => source().emit({ ...eventBase, type: "criterion.changed", payload: { id: 12 } }));
    act(() => source().emit({ ...eventBase, type: "criterion.changed", payload: { id: 12 } }));
    await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/criteria/12")).toHaveLength(before + 1));
  });
});

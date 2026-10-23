import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AcceptanceHistoryPage, AcceptanceVote } from "../../../src/store/acceptance-types";
import { installFakeApi, jsonResponse } from "../test/fakeApi";
import { ArchivedVotes } from "./ArchivedVotes";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const route = "/api/swarms/3/acceptance/history";
const vote: AcceptanceVote = { agent: "Maria", run: 1, verdict: "blocked", reason: "Archived objection", updatedAt: 1 };

it("continues through empty bounded scans and deduplicates keyset pages with visible completeness", async () => {
  const api = installFakeApi();
  api.on("GET", route, ({ query }) => {
    if (query.get("after") === "second")
      return {
        votes: [vote, { ...vote, run: 2, reason: "Second run reason" }],
        next: null,
        complete: true,
        scanned: 1,
      };
    if (query.get("after") === "first") return { votes: [vote], next: "second", complete: false, scanned: 1 };
    return { votes: [], next: "first", complete: false, scanned: 20 };
  });
  render(<ArchivedVotes swarmId={3} />);
  expect(await screen.findByText("No votes in this bounded scan; more history is available.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show more archived votes" }));
  expect(await screen.findByText("Archived objection")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show more archived votes" }));
  expect(await screen.findByText("Second run reason")).toBeInTheDocument();
  expect(screen.getAllByText("Archived objection")).toHaveLength(1);
  expect(screen.getByText("History complete for this scan. Scanned 22 retired records.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show more archived votes" })).not.toBeInTheDocument();
  expect(api.callsTo("GET", route).map((call) => call.query.get("after"))).toEqual([null, "first", "second"]);
});

it("reports a failed read and retries only on explicit request", async () => {
  const api = installFakeApi();
  let reads = 0;
  api.on("GET", route, () =>
    ++reads === 1
      ? jsonResponse(500, { error: "internal", message: "History temporarily unavailable" })
      : { votes: [], next: null, complete: true, scanned: 0 },
  );
  render(<ArchivedVotes swarmId={3} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("History temporarily unavailable");
  expect(api.callsTo("GET", route)).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Retry archived history" }));
  expect(await screen.findByText("No archived votes.")).toBeInTheDocument();
  expect(api.callsTo("GET", route)).toHaveLength(2);
});

it("aborts an unfinished continuation read when the popover unmounts", async () => {
  const api = installFakeApi();
  let release = () => {};
  const pending = new Promise<AcceptanceHistoryPage>((resolve) => {
    release = () => resolve({ votes: [vote], next: null, complete: true, scanned: 1 });
  });
  api.on("GET", route, ({ query }) =>
    query.has("after") ? pending : { votes: [], next: "first", complete: false, scanned: 1 },
  );
  const view = render(<ArchivedVotes swarmId={3} />);
  await userEvent.click(await screen.findByRole("button", { name: "Show more archived votes" }));
  const signal = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    release();
    await pending;
  });
});

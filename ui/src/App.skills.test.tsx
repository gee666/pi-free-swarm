import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { dashboardFixture } from "./pages/dashboard/testFixture";
import { detail, swarm } from "./pages/agents/testFixtures";
import { installFakeApi } from "./test/fakeApi";
import { FakeEventSource, installFakeEventSource } from "./test/fakeEventSource";

const path = "/s/3/skills/search";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a directly loaded skill URL and opens its detail through the app routes", async () => {
  const api = installFakeApi();
  installFakeEventSource();
  const skill = {
    name: "search",
    title: "Search",
    description: "Rank work",
    path: ".pi/swarm/skills/search",
    contentHash: "abc",
    revision: 3,
    error: null,
    updatedAt: 1000,
    content: "# Search instructions\nRead the catalogue.",
    files: ["SKILL.md"],
  };
  api.on("GET", "/api/swarms", () => ({ swarms: [swarm] }));
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/3/dashboard", dashboardFixture);
  api.on("GET", "/api/swarms/3/skills", () => ({ items: [skill], nextCursor: null, notes: [], mode: "filter" }));
  api.on("GET", "/api/swarms/3/skills/search", () => skill);
  window.history.replaceState(null, "", path);
  render(<App />);
  act(() => FakeEventSource.instances.forEach((source) => source.open()));
  expect(await screen.findByRole("heading", { name: "search", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Search instructions" })).toBeInTheDocument();
  await waitFor(() => expect(window.location.pathname).toBe(path));
  expect(api.callsTo("GET", "/api/swarms/3/skills/search")).toHaveLength(1);
});

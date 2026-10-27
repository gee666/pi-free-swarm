import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SkillResponse, SkillsResponse } from "../../../../src/api-types";
import { SwarmStreamProvider } from "../../api/SwarmStream";
import { FilePreviewProvider } from "../../components/FilePreview";
import { installFakeApi, jsonResponse, type FakeApi } from "../../test/fakeApi";
import { installFakeEventSource, type FakeEventSource } from "../../test/fakeEventSource";
import { SkillsPage } from "./SkillsPage";

const skill: SkillResponse = {
  name: "search",
  title: "Search",
  description: "Rank matching work",
  path: ".pi/swarm/skills/search",
  contentHash: "abc",
  revision: 3,
  error: null,
  updatedAt: 1000,
  content: "---\nname: search\ndescription: Frontmatter description\n---\n# Search skill\nRead the catalogue.",
  files: ["SKILL.md", "examples.md"],
};
const page: SkillsResponse = {
  items: [skill, { ...skill, name: "broken", error: "missing description" }],
  nextCursor: null,
  notes: [],
  mode: "bm25",
};
let api: FakeApi;
let source: () => FakeEventSource;
beforeEach(() => {
  api = installFakeApi();
  source = installFakeEventSource();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(path = "/s/3/skills") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SwarmStreamProvider swarmId="3">
        <FilePreviewProvider swarmId="3">
          <Routes>
            <Route path="/s/:id/skills/:name?" element={<SkillsPage />} />
          </Routes>
        </FilePreviewProvider>
      </SwarmStreamProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
}

it("lists valid and invalid skills, opens files and renders SKILL.md", async () => {
  api.on("GET", "/api/swarms/3/skills", () => page);
  api.on("GET", "/api/swarms/3/skills/search", () => skill);
  mount();
  expect(await screen.findByText("Invalid: missing description")).toBeInTheDocument();
  expect(screen.getByText(/Agents add skills by writing folders/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: /search Rank matching work rev 3/ }));
  expect(await screen.findByRole("heading", { name: "search", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Search skill" })).toBeInTheDocument();
  expect(screen.queryByText(/Frontmatter description/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "SKILL.md" }).parentElement).not.toBe(
    screen.getByRole("link", { name: "examples.md" }).parentElement,
  );
  expect(screen.getByRole("link", { name: "examples.md" })).toHaveAttribute(
    "title",
    "Preview .pi/swarm/skills/search/examples.md",
  );
});

it("searches after debounce, surfaces search notes and refetches skill changes", async () => {
  api.on("GET", "/api/swarms/3/skills", ({ query }) => ({
    ...page,
    notes: query.get("query") ? ["Search is lexical"] : [],
  }));
  api.on("GET", "/api/swarms/3/skills/search", () => skill);
  mount("/s/3/skills/search");
  await screen.findByRole("heading", { name: "search", level: 1 });
  await userEvent.type(screen.getByRole("textbox", { name: "Search skills" }), "ranking");
  expect(await screen.findByRole("status")).toHaveTextContent("Search is lexical");
  expect(api.callsTo("GET", "/api/swarms/3/skills").at(-1)?.query.get("query")).toBe("ranking");
  const before = api.callsTo("GET", "/api/swarms/3/skills").length;
  act(() => source().emit({ id: 1, swarmId: 3, type: "skill.changed", payload: { id: "search" }, createdAt: 1000 }));
  await waitFor(() => expect(api.callsTo("GET", "/api/swarms/3/skills")).toHaveLength(before + 1));
  expect(api.callsTo("GET", "/api/swarms/3/skills/search")).toHaveLength(2);
});

it("starts a fresh first page when the debounced search changes", async () => {
  api.on("GET", "/api/swarms/3/skills", ({ query }) => ({
    ...page,
    items: query.get("query") ? [skill] : [{ ...skill, name: query.has("cursor") ? "second" : "first" }],
    nextCursor: !query.get("query") && !query.has("cursor") ? "next" : null,
  }));
  mount();
  await screen.findByRole("link", { name: /first Rank matching work/ });
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("link", { name: /second Rank matching work/ });
  const before = api.callsTo("GET", "/api/swarms/3/skills").length;
  await userEvent.type(screen.getByRole("textbox", { name: "Search skills" }), "search");
  await screen.findByRole("link", { name: /search Rank matching work/ });
  const searches = api.callsTo("GET", "/api/swarms/3/skills").slice(before);
  expect(searches).toHaveLength(1);
  expect(searches[0]?.query.get("query")).toBe("search");
  expect(searches[0]?.query.has("cursor")).toBe(false);
  expect(screen.queryByRole("link", { name: /first Rank matching work/ })).not.toBeInTheDocument();
});

it("retries errors and displays the empty catalogue", async () => {
  api.on("GET", "/api/swarms/3/skills", () => jsonResponse(500, { error: "internal", message: "Unavailable" }));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  api.on("GET", "/api/swarms/3/skills", () => ({ ...page, items: [] }));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No skills found")).toBeInTheDocument();
});

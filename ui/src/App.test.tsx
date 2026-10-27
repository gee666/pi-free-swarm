import { render, screen } from "@testing-library/react";
import { Outlet, useParams } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeApi } from "./test/fakeApi";
import { installFakeEventSource } from "./test/fakeEventSource";
import { App } from "./App";

vi.mock("./shell/SwarmLayout", () => ({ SwarmLayout: () => <Outlet /> }));
vi.mock("./pages/dashboard/DashboardPage", () => ({ DashboardPage: () => <h1>Dashboard route</h1> }));
vi.mock("./pages/criteria/CriteriaPage", () => ({ CriteriaPage: () => <h1>Criterion {useParams().criterionId}</h1> }));
vi.mock("./pages/tasks/TasksPage", () => ({ TasksPage: () => <h1>Task {useParams().taskId}</h1> }));
vi.mock("./pages/skills/SkillsPage", () => ({ SkillsPage: () => <h1>Skill {useParams().name}</h1> }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it.each([
  ["/s/3", "Dashboard route"],
  ["/s/3/dashboard", "Dashboard route"],
  ["/s/3/criteria/12", "Criterion 12"],
  ["/s/3/criteria", "Criterion"],
  ["/s/3/tasks/34", "Task 34"],
  ["/s/3/tasks", "Task"],
  ["/s/3/skills/search", "Skill search"],
  ["/s/3/skills", "Skill"],
])("routes %s", async (path, heading) => {
  installFakeEventSource();
  installFakeApi();
  window.history.replaceState(null, "", path);
  render(<App />);
  expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  if (path === "/s/3") expect(window.location.pathname).toBe("/s/3/dashboard");
});

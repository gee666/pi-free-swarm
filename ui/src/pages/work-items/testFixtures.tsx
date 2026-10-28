import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type {
  CriterionDetailResponse,
  CriterionListItem,
  SearchPage,
  TaskDetailResponse,
  TaskListItem,
} from "../../../../src/api-types";
import { SwarmViewProvider } from "../../api/SwarmView";
import type { FakeApi } from "../../test/fakeApi";
import type { FakeEventSource } from "../../test/fakeEventSource";
import { detail } from "../agents/testFixtures";

const at = new Date(2026, 3, 12, 10, 24).getTime();
export function criterion(patch: Partial<CriterionDetailResponse> = {}): CriterionDetailResponse {
  return {
    id: 12,
    swarmId: 3,
    group: "Search",
    title: "Rank matches",
    body: "Rank work by relevance",
    verification: "Run ranking tests",
    source: "",
    author: "Ann",
    updatedBy: "Ann",
    revision: 3,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    status: "incomplete",
    linkedTaskCount: 1,
    voteProgress: { current: 0, required: 2, label: "votes 0/2" },
    reasons: ["Linked tasks not accepted"],
    tasks: [],
    votes: [],
    requiredOwners: ["Ann"],
    offlineTasks: [],
    missingVoters: ["Ann", "independent"],
    missingCovered: [],
    missingBlocked: [],
    blocker: null,
    agreement: { current: 0, required: 2, label: "0/2 agreed" },
    linkedPosts: [],
    ...patch,
  };
}
export function task(patch: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    id: 34,
    swarmId: 3,
    title: "Add ranking index",
    body: "Build the index",
    status: "new",
    owner: null,
    author: "Bob",
    revision: 6,
    contentRevision: 1,
    createdAt: at,
    updatedAt: at,
    acceptedAt: null,
    acceptedBy: null,
    waitsOn: [],
    waiting: false,
    runnable: true,
    deferred: false,
    criteria: [{ criterionId: 12, contribution: "Ranks work", title: "Rank matches", status: "incomplete" }],
    dependencies: [],
    dependents: [],
    latestEvidence: null,
    evidence: null,
    reviewVerdict: null,
    timeline: [],
    nextAfter: null,
    linkedPosts: [],
    validActions: ["claim", "edit"],
    handoffTargets: ["John"],
    ...patch,
  };
}
export function page<T>(items: T[], patch: Partial<SearchPage<T>> = {}): SearchPage<T> {
  return { items, nextCursor: null, mode: "filter", notes: [], ...patch };
}
export function workApi(api: FakeApi, criteria: CriterionListItem[] = [criterion()], tasks: TaskListItem[] = [task()]) {
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/3/criteria", () => page(criteria));
  api.on("GET", "/api/swarms/3/criteria/groups", () => ({
    groups: ["Search", "Main"].map((group) => ({
      group,
      satisfied: criteria.filter((item) => item.group === group && item.status === "satisfied").length,
      blocked: 0,
      incomplete: 0,
      unlinked: 0,
      total: criteria.filter((item) => item.group === group).length,
    })),
  }));
  api.on("GET", "/api/swarms/3/tasks", () => page(tasks));
  api.on("GET", "/api/swarms/3/criteria/12", () => criteria[0]);
  api.on("GET", "/api/swarms/3/tasks/34", () => tasks[0]);
}
export function renderWork(
  path: string,
  route: string,
  node: ReactNode,
  source: () => FakeEventSource,
  state?: object,
) {
  render(
    <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path={route} element={node} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
}

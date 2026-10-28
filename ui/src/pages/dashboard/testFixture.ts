import type { DashboardResponse } from "../../../../src/api-types";

export function dashboardFixture(): DashboardResponse {
  const gates: DashboardResponse["gates"] = [
    { key: "linked", ok: false, count: 3, detail: "3 unlinked" },
    { key: "tasks", ok: false, count: 14, detail: "14 open, 2 deferred" },
    { key: "criteria", ok: false, count: 9, detail: "9 awaiting votes" },
    { key: "review", ok: false, count: 2, detail: "2 in review" },
  ];
  return {
    project: {
      id: 3,
      briefPath: "brief.md",
      intentSummary: "Build search",
      intentPath: "intent.md",
      intentRevision: 3,
      intentUpdatedBy: "Ann",
      outcome: null,
    },
    completion: { done: false, outcome: null, gates },
    gates,
    header: { state: "running", run: 2, agentCount: 14, startedAt: Date.now() - 4320000 },
    counts: {
      tasks: 97,
      accepted: 61,
      remaining: 36,
      criteria: 42,
      unlinked: 3,
      satisfied: 18,
      blocked: 1,
      incomplete: 20,
      inProgress: 8,
      inReview: 2,
      waiting: 3,
      runnable: 5,
      deferred: 2,
    },
    velocity: { accepted15Minutes: 2, accepted60Minutes: 4, etaMs: null },
    etaMs: null,
    criteriaCoverage: [
      { group: "Search", total: 9, satisfied: 7, blocked: 1, incomplete: 1, unlinked: 0 },
      { group: "Main", total: 4, satisfied: 0, blocked: 0, incomplete: 1, unlinked: 3 },
    ],
    attention: { agreedBlockers: [], unreadUserUpdates: 2 },
    recentActivity: [
      {
        id: "task-event:1",
        actor: "Ann",
        kind: "review_accepted",
        targetKind: "task",
        targetId: 34,
        title: "Add BM25 index",
        createdAt: Date.now() - 120000,
      },
    ],
    queue: { tasks: [], criteria: [] },
    runnable: [],
  };
}

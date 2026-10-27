import type { CompletionGate, DashboardResponse } from "../../../../src/api-types";

export const GATE_LABELS: Record<CompletionGate["key"], string> = {
  scope: "Scope approved",
  linked: "Every criterion linked",
  tasks: "Every task accepted",
  criteria: "Every criterion agreed",
  review: "No pending reviews",
};
export const GATE_FILTERS: Record<CompletionGate["key"], string> = {
  scope: "criteria",
  linked: "criteria?status=unlinked",
  tasks: "tasks?status=new,claimed,in_progress,review",
  criteria: "criteria?status=unlinked,incomplete,blocked",
  review: "tasks?status=review",
};
export function gateDetail(data: DashboardResponse, gate: CompletionGate): string {
  switch (gate.key) {
    case "scope":
      return `rev ${data.project.scopeRevision} ${gate.ok ? "approved" : "needs approval"}`;
    case "linked":
      return `${gate.count} unlinked`;
    case "tasks":
      return `${gate.count} open, ${data.counts.deferred} deferred`;
    case "criteria": {
      const pending = data.attention.blockerDecisions.length;
      return `${gate.count} awaiting votes${pending ? ` · ${pending} blocker${pending === 1 ? "" : "s"} awaiting you` : ""}`;
    }
    case "review":
      return `${gate.count} in review`;
  }
}

export function shortDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
export function activityLabel(kind: string) {
  const labels: Record<string, string> = {
    review_accepted: "accepted",
    review_requested: "requested review",
    criterion_created: "created",
    criterion_vote: "voted on",
    criterion_blocker: "recorded blocker on",
    criterion_decision: "decided exception on",
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

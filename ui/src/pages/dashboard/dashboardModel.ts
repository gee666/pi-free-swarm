import type { CompletionGate, DashboardResponse } from "../../../../src/api-types";

export const GATE_LABELS: Record<CompletionGate["key"], string> = {
  linked: "Every criterion linked",
  tasks: "Every task accepted",
  criteria: "Every criterion agreed",
  review: "No pending reviews",
};
export const GATE_FILTERS: Record<CompletionGate["key"], string> = {
  linked: "criteria?status=unlinked",
  tasks: "tasks?status=new,claimed,in_progress,review",
  criteria: "criteria?status=unlinked,incomplete",
  review: "tasks?status=review",
};
export function gateDetail(data: DashboardResponse, gate: CompletionGate): string {
  switch (gate.key) {
    case "linked":
      return `${gate.count} unlinked`;
    case "tasks":
      return `${gate.count} open, ${data.counts.deferred} deferred`;
    case "criteria":
      return `${gate.count} awaiting votes`;
    case "review":
      return `${gate.count} in review`;
  }
}

export function activityLabel(kind: string) {
  const labels: Record<string, string> = {
    review_accepted: "accepted",
    review_requested: "requested review",
    voted: "voted on",
    blocker_recorded: "recorded blocker on",
    blocker_decided: "rejected blocker on",
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

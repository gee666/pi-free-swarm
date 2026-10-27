import type { CompletionResult, ProjectRecord, TaskRecord } from "./api-work-types.js";
import type { CriterionListItem } from "./api-work-http-types.js";

export type RunHeaderState = "running" | "completed" | "stopped_with_blockers" | "stopped" | "interrupted";
export interface RunHeader {
  state: RunHeaderState;
  run: number;
  agentCount: number;
  startedAt: number | null;
}
export interface CriteriaCoverage {
  group: string;
  satisfied: number;
  blocked: number;
  incomplete: number;
  unlinked: number;
  total: number;
}
export interface WorkActivityRow {
  id: string;
  actor: string;
  kind: string;
  targetKind: "task" | "criterion";
  targetId: number;
  title: string;
  createdAt: number;
}
export interface DashboardResponse {
  project: ProjectRecord;
  completion: CompletionResult;
  gates: CompletionResult["gates"];
  counts: {
    tasks: number;
    accepted: number;
    remaining: number;
    criteria: number;
    unlinked: number;
    satisfied: number;
    blocked: number;
    incomplete: number;
    inProgress: number;
    inReview: number;
    waiting: number;
    runnable: number;
    deferred: number;
  };
  velocity: { accepted15Minutes: number; accepted60Minutes: number; etaMs: number | null };
  etaMs: number | null;
  header: RunHeader;
  criteriaCoverage: CriteriaCoverage[];
  recentActivity: WorkActivityRow[];
  attention: {
    agreedBlockers: CriterionListItem[];
    unreadUserMessages: number;
  };
  queue: {
    tasks: TaskRecord[];
    reviews: TaskRecord[];
    criteria: { id: number; title: string; text: string; updatedAt: number }[];
  };
  runnable: { id: number; title: string; text: string; updatedAt: number }[];
}

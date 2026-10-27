export type TaskStatus = "new" | "claimed" | "in_progress" | "review" | "accepted";
export type CriterionStatus = "unlinked" | "incomplete" | "satisfied" | "blocked";
export type VoteVerdict = "satisfied" | "incomplete" | "blocked";
export type WorkOutcome = "completed" | "stopped_with_blockers";

export interface TaskRecord {
  id: number;
  swarmId: number;
  title: string;
  body: string;
  status: TaskStatus;
  owner: string | null;
  author: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
  acceptedBy: string | null;
}
export interface CriterionRecord {
  id: number;
  swarmId: number;
  group: string;
  title: string;
  body: string;
  verification: string;
  source: string;
  author: string;
  updatedBy: string;
  revision: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface CriterionLink {
  criterionId: number;
  contribution: string;
}
export interface CriterionVote {
  criterionId: number;
  voter: string;
  verdict: VoteVerdict;
  reason: string;
  criterionRevision: number;
  linksSignature: string;
  blockerRevision: number | null;
  createdAt: number;
}
export interface CriterionBlocker {
  criterionId: number;
  revision: number;
  reason: string;
  missing: string;
  attempted: string;
  unblock: string;
  author: string;
  updatedAt: number;
  rejectedRevision: number | null;
  decidedAt: number | null;
}
export type TaskEventKind =
  | "created"
  | "edited"
  | "claimed"
  | "released"
  | "handoff"
  | "started"
  | "review_requested"
  | "review_accepted"
  | "changes_requested"
  | "reopened"
  | "linked"
  | "unlinked"
  | "dependency_added"
  | "dependency_removed"
  | "dependencies_ready"
  | "dependency_reopened";
export interface TaskEvent {
  id: number;
  swarmId: number;
  taskId: number;
  actor: string;
  kind: TaskEventKind;
  body: string;
  evidence: string;
  reviewer: string | null;
  createdAt: number;
}
export interface ProjectRecord {
  id: number;
  briefPath: string | null;
  intentSummary: string | null;
  intentPath: string | null;
  intentUpdatedBy: string | null;
  intentRevision: number;
  outcome: WorkOutcome | null;
}
export interface CompletionGate {
  key: "linked" | "tasks" | "criteria" | "review";
  ok: boolean;
  count: number;
  detail: string;
}
export interface CompletionResult {
  done: boolean;
  outcome: WorkOutcome | null;
  gates: CompletionGate[];
}

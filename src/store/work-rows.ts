import type {
  CriterionBlocker,
  CriterionRecord,
  CriterionVote,
  ProjectRecord,
  TaskEvent,
  TaskRecord,
  WorkOutcome,
} from "../api-work-types.js";
import { int, intOrNull, text, textOrNull, type Row } from "./rows.js";

export function enumText<T extends string>(row: Row, key: string, values: readonly T[]): T {
  const value = text(row, key);
  const found = values.find((item) => item === value);
  if (found === undefined) throw new Error(`Unexpected ${key}: ${value}`);
  return found;
}

export function taskOf(row: Row): TaskRecord {
  return {
    id: int(row, "id"),
    swarmId: int(row, "swarm_id"),
    title: text(row, "title"),
    body: text(row, "body"),
    status: enumText(row, "status", ["new", "claimed", "in_progress", "review", "accepted"]),
    owner: textOrNull(row, "owner"),
    author: text(row, "author"),
    revision: int(row, "revision"),
    createdAt: int(row, "created_at"),
    updatedAt: int(row, "updated_at"),
    acceptedAt: intOrNull(row, "accepted_at"),
    acceptedBy: textOrNull(row, "accepted_by"),
  };
}
export function criterionOf(row: Row): CriterionRecord {
  return {
    id: int(row, "id"),
    swarmId: int(row, "swarm_id"),
    group: text(row, "group_name"),
    title: text(row, "title"),
    body: text(row, "body"),
    verification: text(row, "verification"),
    source: text(row, "source"),
    author: text(row, "author"),
    revision: int(row, "revision"),
    archivedAt: intOrNull(row, "archived_at"),
    createdAt: int(row, "created_at"),
    updatedAt: int(row, "updated_at"),
  };
}
export function voteOf(row: Row): CriterionVote {
  return {
    criterionId: int(row, "criterion_id"),
    voter: text(row, "voter"),
    verdict: enumText(row, "verdict", ["satisfied", "incomplete", "blocked"]),
    reason: text(row, "reason"),
    criterionRevision: int(row, "criterion_revision"),
    linksSignature: text(row, "links_signature"),
    blockerRevision: intOrNull(row, "blocker_revision"),
    createdAt: int(row, "created_at"),
  };
}
export function blockerOf(row: Row): CriterionBlocker {
  return {
    criterionId: int(row, "criterion_id"),
    revision: int(row, "revision"),
    reason: text(row, "reason"),
    missing: text(row, "missing"),
    attempted: text(row, "attempted"),
    unblock: text(row, "unblock"),
    author: text(row, "author"),
    updatedAt: int(row, "updated_at"),
    approvedRevision: intOrNull(row, "approved_revision"),
    rejectedRevision: intOrNull(row, "rejected_revision"),
    decidedAt: intOrNull(row, "decided_at"),
  };
}
export function taskEventOf(row: Row): TaskEvent {
  return {
    id: int(row, "id"),
    swarmId: int(row, "swarm_id"),
    taskId: int(row, "task_id"),
    actor: text(row, "actor"),
    kind: enumText(row, "kind", [
      "created",
      "edited",
      "claimed",
      "released",
      "handoff",
      "started",
      "review_requested",
      "review_accepted",
      "changes_requested",
      "reopened",
      "linked",
      "unlinked",
      "dependency_added",
      "dependency_removed",
      "dependencies_ready",
      "dependency_reopened",
    ]),
    body: text(row, "body"),
    evidence: text(row, "evidence"),
    createdAt: int(row, "created_at"),
  };
}
export function projectOf(row: Row): ProjectRecord {
  return {
    id: int(row, "id"),
    briefPath: textOrNull(row, "brief_path"),
    intentSummary: textOrNull(row, "intent_summary"),
    intentPath: textOrNull(row, "intent_path"),
    intentRevision: int(row, "intent_revision"),
    scopeRevision: int(row, "scope_revision"),
    scopeApprovedRevision: intOrNull(row, "scope_approved_revision"),
    scopeApprovedAt: intOrNull(row, "scope_approved_at"),
    outcome:
      row.outcome === null ? null : enumText<WorkOutcome>(row, "outcome", ["completed", "stopped_with_blockers"]),
  };
}

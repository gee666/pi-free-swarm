import type {
  CriterionBlocker,
  CriterionLink,
  CriterionRecord,
  CriterionStatus,
  CriterionVote,
  TaskEvent,
  TaskRecord,
  TaskStatus,
  VoteVerdict,
} from "./api-work-types.js";
import type { PostSummary } from "./api-wall-types.js";
import type { CriteriaCoverage } from "./api-dashboard-types.js";
import type { Skill, SkillDetail } from "./skills/index.js";

export interface SearchQuery {
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface SearchPage<T> {
  items: T[];
  nextCursor: string | null;
  notes: string[];
  mode: "filter" | "bm25" | "hybrid" | "reranked";
}
export interface CriteriaQuery extends SearchQuery {
  status?: CriterionStatus[];
  group?: string;
  taskId?: number;
  author?: string;
  needsMyVote?: boolean;
  includeArchived?: boolean;
}
export interface TasksQuery extends SearchQuery {
  status?: TaskStatus[];
  owner?: string;
  author?: string;
  criterionId?: number;
  runnable?: boolean;
  waiting?: boolean;
  deferred?: boolean;
}
export interface PostsSearchQuery extends SearchQuery {
  author?: string;
  taskId?: number;
  criterionId?: number;
}
export interface VoteProgress {
  current: number;
  required: number;
  label: string;
}
export interface CriterionListItem extends CriterionRecord {
  status: CriterionStatus;
  linkedTaskCount: number;
  voteProgress: VoteProgress;
  reasons: string[];
}
export type CriteriaResponse = SearchPage<CriterionListItem>;
export interface CriteriaGroupsResponse {
  groups: CriteriaCoverage[];
}
export interface CriterionVoteView extends CriterionVote {
  role: "owner" | "independent";
  stale: boolean;
}
export interface CriterionTaskView extends TaskRecord {
  contribution: string;
}
export interface CriterionDetailResponse extends CriterionListItem {
  tasks: CriterionTaskView[];
  votes: CriterionVoteView[];
  requiredOwners: string[];
  offlineTasks: number[];
  missingVoters: string[];
  missingCovered: string[];
  missingBlocked: string[];
  blocker: CriterionBlocker | null;
  agreement: VoteProgress;
  linkedPosts: PostSummary[];
}
export interface TaskListItem extends TaskRecord {
  waitsOn: number[];
  reviewer: string | null;
  waiting: boolean;
  runnable: boolean;
  deferred: boolean;
}
export type TasksResponse = SearchPage<TaskListItem>;
export type TaskUserAction =
  "edit" | "claim" | "release" | "handoff" | "start" | "request-review" | "review" | "reopen";
export interface TaskCriterionView extends CriterionLink {
  title: string;
  status: CriterionStatus;
}
export interface TaskDetailQuery {
  after?: number;
  limit?: number;
}
export interface TaskDetailResponse extends TaskListItem {
  criteria: TaskCriterionView[];
  dependencies: TaskRecord[];
  dependents: TaskRecord[];
  latestEvidence: string | null;
  evidence: TaskEvent | null;
  reviewerVerdict: TaskEvent | null;
  timeline: TaskEvent[];
  nextAfter: number | null;
  linkedPosts: PostSummary[];
  validActions: TaskUserAction[];
  handoffTargets: string[];
}
export interface PostLinkView {
  postId: number;
  targetKind: "task" | "criterion";
  targetId: number;
  linkedBy: string;
  linkedAt: number;
  title: string;
  status: TaskStatus | "waiting" | CriterionStatus;
}
export interface PostLinksRequest {
  taskIds?: number[];
  criterionIds?: number[];
}
export interface PostLinksResponse {
  id: number;
  links: PostLinkView[];
}
export interface PostsSearchResponse extends SearchPage<PostSummary> {
  posts: PostSummary[];
  total: number;
}
export type SkillsResponse = SearchPage<Skill>;
export type SkillResponse = SkillDetail;
export interface SearchConfigResponse {
  ranking: "bm25";
  embedding: string | "off";
  reranker: string | "off";
  maxResults: number;
}
export interface RevisionRequest {
  expectedRevision?: number;
}
export type CreateCriterionRequest = Pick<CriterionRecord, "group" | "title" | "body" | "verification" | "source">;
export interface EditCriterionRequest {
  expectedRevision: number;
  fields: Partial<CreateCriterionRequest>;
}
export interface VoteCriterionRequest extends RevisionRequest {
  verdict: VoteVerdict;
  reason: string;
}
export interface BlockCriterionRequest extends RevisionRequest {
  reason: string;
  missing: string;
  attempted: string;
  unblock: string;
}
export interface BlockerDecisionRequest extends RevisionRequest {
  decision: "reject";
}
export type CriterionMutationResponse = CriterionRecord;
export type CriterionVoteResponse = CriterionVote;
export type CriterionBlockerResponse = CriterionBlocker;
export interface CreateTaskRequest {
  title: string;
  body: string;
  criteria: CriterionLink[];
  dependsOn?: number[];
  claim?: boolean;
}
export interface EditTaskRequest {
  expectedRevision: number;
  fields: Partial<Omit<CreateTaskRequest, "claim">>;
}
export interface HandoffTaskRequest extends RevisionRequest {
  to: string;
}
export interface RequestTaskReviewRequest extends RevisionRequest {
  evidence: string;
}
export interface ReviewTaskRequest extends RevisionRequest {
  verdict: "accept" | "changes";
  reason: string;
}
export interface ReopenTaskRequest extends RevisionRequest {
  reason: string;
}
export type TaskMutationResponse = TaskRecord;

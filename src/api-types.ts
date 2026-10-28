/*
 * Frozen contract shared by the backend and the UI. Types only, no runtime code, so the UI can
 * `import type` it (session view types come from api-session-types.ts through the re-export below).
 *
 * Conventions:
 * - Every API payload, SSE payload and record in this file is camelCase. SQL columns are snake_case;
 *   only src/store maps between the two, and snake_case rows never leave src/store.
 * - Timestamps are epoch milliseconds. Durations are milliseconds and end in `Ms`.
 * - Posts, comments and messages carry their content in `text` (the SQL column is `body`).
 * - Participant names are canonical as stored ("Maria"); lookups ignore case.
 */

export type * from "./api-session-types.js";
import type { UsageTotals } from "./api-usage-types.js";
import type { CommentView, PostSummary } from "./api-wall-types.js";
export type * from "./api-wall-types.js";
import type { MessageCreatedPayload, MessageStatusPayload, UserUnreadSummary } from "./api-user-unread-types.js";
export type * from "./api-user-unread-types.js";

export type * from "./api-common-types.js";
import type {
  AgentActivity,
  ParticipantKind,
  ParticipantStatus,
  RecipientStatus,
  SwarmStatus,
} from "./api-common-types.js";

// ── Records (what src/store returns, reused by the API) ───────────────────────
export interface SwarmListItem {
  id: number;
  name: string;
  taskPrompt: string;
  /** Already resolved: `starting`/`running` with a stale run lock is reported as `interrupted`. */
  status: SwarmStatus;
  /** Whether the live run admits worker actions. */
  acceptsMessages: boolean;
  agentAmount: number;
  agentsWorking: number;
  runCount: number;
  /** Pid of the main process running the swarm; `null` when nobody runs it. */
  runnerPid: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Missing/null on historical runs with no recorded launch provenance. */
  configuration?: import("./run-configuration.js").SavedRunConfiguration | null;
  budget?: import("./budget.js").BudgetStatus | null;
}

export interface AgentParticipantView {
  kind: "agent";
  name: string;
  status: ParticipantStatus;
  launchOrder: number;
  reviveCount: number;
  retiredAt?: number | null;
  /** Durable replacement identity; absent/null for removals without a replacement. */
  successorName?: string | null;
  firstIdleAt?: number | null;
  /** Recorded effective assignment, never guessed for historical workers. */
  model?: import("./run-configuration.js").WorkerAssignment | null;
  activity: AgentActivity | null;
  /** Inbox messages not yet in the agent's context (recipient status pending or delivered). */
  unread: number;
  /** USD spent by this agent over all runs; kept current by `usage.updated`. */
  cost: number;
  joinedAt: number | null;
  lastActivityAt: number | null;
}

export interface UserParticipantView {
  kind: "user";
  name: "User";
  /** Historical inbox count; Wall attention is returned separately in userUnread. */
  unread: number;
  joinedAt: number | null;
  lastActivityAt: number | null;
}

/** `Main` and `System` are senders only and never appear in participant lists. */
export type ParticipantView = AgentParticipantView | UserParticipantView;

export interface RecipientView {
  name: string;
  status: RecipientStatus;
  deliveredAt: number | null;
  readAt: number | null;
}

export interface MessageView {
  id: number;
  swarmId: number;
  threadId: number;
  sender: string;
  senderKind: ParticipantKind;
  text: string;
  createdAt: number;
  /** One entry per recipient, in the order they were addressed. Empty for nobody (never happens today). */
  recipients: RecipientView[];
}

/** Unread counts of the participants a change touched, keyed by canonical name. */
export type UnreadCounts = Record<string, number>;

export type * from "./api-usage-types.js";

// ── REST: /api/swarms ─────────────────────────────────────────────────────────

/** GET /api/swarms — newest first. */
export interface SwarmListResponse {
  swarms: SwarmListItem[];
}

/** GET /api/swarms/:id — participants are `User` first, then agents by launch order. */
export interface SwarmDetailResponse {
  swarm: SwarmListItem;
  participants: ParticipantView[];
  userUnread?: UserUnreadSummary;
}

// ── REST: wall ────────────────────────────────────────────────────────────────

/** GET /api/swarms/:id/posts?count&offset (defaults 20 / 0, count ≤ 100). */
export interface PostListQuery {
  count?: number;
  offset?: number;
}

/** Newest first. */
export interface PostListResponse {
  posts: PostSummary[];
  total: number;
}

/** GET /api/swarms/:id/posts/:postId — comments oldest first. */
export interface PostDetailResponse {
  post: PostSummary;
  comments: CommentView[];
  links: import("./api-work-http-types.js").PostLinkView[];
}

/** POST /api/swarms/:id/posts. The REST API always acts as `User`, so there is no author field. */
export interface CreatePostRequest {
  broadcast?: boolean;
  title: string;
  text: string;
  taskIds?: number[];
  criterionIds?: number[];
}

export interface CreatePostResponse {
  post: PostSummary;
  links: import("./api-work-http-types.js").PostLinkView[];
}

/** POST /api/swarms/:id/posts/:postId/comments (as `User`). */
export interface CreateCommentRequest {
  text: string;
}

export interface CreateCommentResponse {
  comment: CommentView;
  commentCount: number;
}

// ── REST: stats ───────────────────────────────────────────────────────────────

export interface AgentStats extends UsageTotals {
  name: string;
  status: ParticipantStatus;
  /** Sum of the agent's working spans; an open span counts up to now. */
  activeTimeMs: number;
  reviveCount: number;
  posts: number;
  comments: number;
  messagesSent: number;
}

export interface StatsTotals extends UsageTotals {
  /** Sum of the swarm's run spans; an open run counts up to now. */
  wallTimeMs: number;
  activeTimeMs: number;
  runCount: number;
  posts: number;
  comments: number;
  /** All messages in the swarm, any sender. */
  messages: number;
}

/** GET /api/swarms/:id/stats — agents in launch order. */
export interface StatsResponse {
  swarmId: number;
  computedAt: number;
  agents: AgentStats[];
  totals: StatsTotals;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * HTTP status per code: validation 400, bad_request 400, not_member 403, not_found 404,
 * swarm_not_running 409, internal 500.
 */
export type ApiErrorCode = "validation" | "bad_request" | "not_member" | "not_found" | "swarm_not_running" | "internal";

export interface ApiErrorBody {
  error: ApiErrorCode;
  /** Human-readable, safe to show as is, e.g. "Too long: 4001/4000 characters. Shorten it or point to a file path." */
  message: string;
  /** Request field a validation error refers to, e.g. "text", "title", "to". */
  field?: string;
  currentRevision?: number;
}

// ── SSE: GET /events?swarm=:id ────────────────────────────────────────────────

export type * from "./api-work-types.js";
export type * from "./api-work-http-types.js";
export type * from "./api-dashboard-types.js";

export interface SwarmEventPayloads {
  "criterion.changed": { id: number };
  "task.changed": { id: number };
  "project.changed": { id: number };
  "post.links.changed": { id: number };
  "skill.changed": { id: string };
  "post.created": { post: PostSummary };
  "comment.created": { comment: CommentView; commentCount: number };
  "user.post.updated": import("./api-user-unread-types.js").UserPostAttention;
  "message.created": MessageCreatedPayload;
  /** One event per recipient change. */
  "message.status": MessageStatusPayload;
  "participant.updated": { participant: ParticipantView };
  /** The agent's cumulative totals for the swarm after the change. */
  "usage.updated": { agent: string; usage: UsageTotals };
  "swarm.updated": { swarm: SwarmListItem };
  /** New session entries exist; fetch them with `?after=<the client's newestCursor>`. */
  "session.appended": { agent: string; newestCursor: string };
}

export type SwarmEventType = keyof SwarmEventPayloads;

/**
 * Wire format: one SSE frame per event, default event name (use `EventSource.onmessage`),
 * `data:` = JSON of this object, `id:` = the outbox id when it has one.
 * Without `?swarm=` the stream carries only `swarm.updated` of all swarms (the picker).
 */
export type SwarmEvent = {
  [T in SwarmEventType]: {
    /** Outbox row id; `null` for `session.appended`, which the server host emits without storing it. */
    id: number | null;
    swarmId: number;
    type: T;
    payload: SwarmEventPayloads[T];
    createdAt: number;
  };
}[SwarmEventType];

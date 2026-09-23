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

// Work-tab session view types live in their own file to keep both under the size limit.
export type * from "./api-session-types.js";

// ── Enums ────────────────────────────────────────────────────────────────────

export type SwarmStatus = "starting" | "running" | "finished" | "stopped" | "interrupted";

export type ParticipantKind = "agent" | "user" | "main" | "system";

/** Only agents have a status. */
export type ParticipantStatus = "pending" | "starting" | "working" | "idle" | "crashed" | "stopped";

/** `pending → delivered → read` never goes backwards; `undeliverable` is final. */
export type RecipientStatus = "pending" | "delivered" | "read" | "undeliverable";

export type AgentRunEndReason = "settled" | "crashed" | "stopped";

export type ReservedName = "User" | "Main" | "System";

export type MailboxKind = "inbox" | "sent";

/** What an agent is doing right now; `null` when idle or not running. */
export type AgentActivity = { kind: "thinking" } | { kind: "writing" } | { kind: "tool"; toolName: string };

// ── Records (what src/store returns, reused by the API) ───────────────────────

export interface SwarmListItem {
  id: number;
  name: string;
  taskPrompt: string;
  /** Already resolved: `starting`/`running` with a stale run lock is reported as `interrupted`. */
  status: SwarmStatus;
  /** Server-side answer to "can messages be sent now" (status is starting/running and the lock is fresh). */
  acceptsMessages: boolean;
  agentAmount: number;
  agentsWorking: number;
  runCount: number;
  /** Pid of the main process running the swarm; `null` when nobody runs it. */
  runnerPid: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AgentParticipantView {
  kind: "agent";
  name: string;
  status: ParticipantStatus;
  launchOrder: number;
  reviveCount: number;
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
  /** Inbox messages the user has not opened yet. */
  unread: number;
  joinedAt: number | null;
  lastActivityAt: number | null;
}

/** `Main` and `System` are senders only and never appear in participant lists. */
export type ParticipantView = AgentParticipantView | UserParticipantView;

export interface PostSummary {
  id: number;
  swarmId: number;
  author: string;
  title: string;
  text: string;
  commentCount: number;
  createdAt: number;
}

export interface CommentView {
  id: number;
  postId: number;
  swarmId: number;
  author: string;
  text: string;
  createdAt: number;
}

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

export interface ThreadView {
  id: number;
  swarmId: number;
  createdBy: string;
  createdAt: number;
  /** All members including the creator, in join order. */
  members: string[];
}

/** Unread counts of the participants a change touched, keyed by canonical name. */
export type UnreadCounts = Record<string, number>;

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD. */
  cost: number;
  /** Assistant messages counted. */
  turns: number;
}

// ── REST: /api/swarms ─────────────────────────────────────────────────────────

/** GET /api/swarms — newest first. */
export interface SwarmListResponse {
  swarms: SwarmListItem[];
}

/** GET /api/swarms/:id — participants are `User` first, then agents by launch order. */
export interface SwarmDetailResponse {
  swarm: SwarmListItem;
  participants: ParticipantView[];
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
}

/** POST /api/swarms/:id/posts. The REST API always acts as `User`, so there is no author field. */
export interface CreatePostRequest {
  title: string;
  text: string;
}

export interface CreatePostResponse {
  post: PostSummary;
}

/** POST /api/swarms/:id/posts/:postId/comments (as `User`). */
export interface CreateCommentRequest {
  text: string;
}

export interface CreateCommentResponse {
  comment: CommentView;
  commentCount: number;
}

// ── REST: messages ────────────────────────────────────────────────────────────

/** GET /api/swarms/:id/participants/:name/messages?box&count&offset (defaults inbox / 20 / 0, count ≤ 100). */
export interface MailboxQuery {
  box?: MailboxKind;
  count?: number;
  offset?: number;
}

export interface MailboxThread {
  thread: ThreadView;
  /**
   * Only this box's messages of the thread, oldest first: messages addressed to the participant (inbox)
   * or sent by it (sent). The collapsed row shows the last one; expanding fetches the whole thread.
   */
  messages: MessageView[];
  /** Inbox only: messages here that the participant has not read. Always 0 for `sent`. */
  unread: number;
  lastMessageAt: number;
}

/** Threads ordered by `lastMessageAt`, newest first. */
export interface MailboxResponse {
  name: string;
  box: MailboxKind;
  threads: MailboxThread[];
  /** Number of threads in this box, for pagination. */
  total: number;
  /** The participant's total unread inbox count (badge value). */
  unread: number;
}

/** GET /api/swarms/:id/threads/:threadId — messages oldest first. */
export interface ThreadResponse {
  thread: ThreadView;
  messages: MessageView[];
}

/** POST /api/swarms/:id/messages (from `User`) — starts a new thread. 409 `swarm_not_running` when not live. */
export interface SendMessageRequest {
  to: string[];
  text: string;
}

/** POST /api/swarms/:id/threads/:threadId/reply (from `User`). Same 409 rule. */
export interface ReplyRequest {
  text: string;
}

/**
 * If the swarm stopped between the liveness check and the insert, the message is still stored with every
 * agent recipient `undeliverable`, and a `System` reply lands in the same thread (delivered via SSE).
 */
export interface SendMessageResponse {
  message: MessageView;
}

/** POST /api/swarms/:id/participants/User/read. Other names answer 404. */
export interface MarkReadRequest {
  messageIds: number[];
}

export interface MarkReadResponse {
  /** Recipient rows that changed to `read`. */
  updated: number;
  /** User's unread count afterwards. */
  unread: number;
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
  /** Human-readable, safe to show as is, e.g. "Too long: 243/200 characters. Shorten it or point to a file path." */
  message: string;
  /** Request field a validation error refers to, e.g. "text", "title", "to". */
  field?: string;
}

// ── SSE: GET /events?swarm=:id ────────────────────────────────────────────────

export interface SwarmEventPayloads {
  "post.created": { post: PostSummary };
  "comment.created": { comment: CommentView; commentCount: number };
  "message.created": { message: MessageView; unread: UnreadCounts };
  /** One event per recipient change. */
  "message.status": { messageId: number; threadId: number; recipient: RecipientView; unread: UnreadCounts };
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

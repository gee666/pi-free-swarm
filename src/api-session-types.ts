// Work-tab session view payloads, re-exported by api-types.ts. Types only, same conventions.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * GET /api/swarms/:id/agents/:name/session?before|after&limit (limit default 50, max 200 session entries).
 * - no cursor: the newest page;
 * - `before=<olderCursor>`: the page just older than that cursor (scrolling down);
 * - `after=<newestCursor>`: everything newer than that cursor, up to `limit` (after `session.appended`).
 * Cursors are opaque strings; never build or compare them on the client.
 */
export interface SessionQuery {
  before?: string;
  after?: string;
  limit?: number;
}

export interface SessionPage {
  agent: string;
  /** Newest first. Items of one session entry keep their in-entry order reversed as well. */
  items: SessionItem[];
  /** Pass as `before` to load older items; `null` when the oldest entry is included or there is no session file yet. */
  olderCursor: string | null;
  /** Pass as `after` to load newer items; `null` when the session has no entries yet. */
  newestCursor: string | null;
}

interface SessionItemBase {
  /** Stable across requests: session entry id plus the block index inside the entry. */
  id: string;
  /** Epoch ms of the session entry. */
  timestamp: number;
}

/** A prompt or user text that is not a delivered swarm message (kickoff, resume, plain text). */
export interface SessionUserItem extends SessionItemBase {
  kind: "user";
  text: string;
}

/** One `[swarm message #id]` block from a delivered prompt or steering message. */
export interface SessionSwarmMessageItem extends SessionItemBase {
  kind: "swarm_message";
  messageId: number;
  threadId: number;
  from: string;
  /** As written in the header: other recipients by name, the agent itself as "You". */
  to: string[];
  text: string;
}

/** Markdown allowed. */
export interface SessionAssistantTextItem extends SessionItemBase {
  kind: "assistant_text";
  text: string;
}

export interface SessionThinkingItem extends SessionItemBase {
  kind: "thinking";
  text: string;
}

export interface SessionToolCallItem extends SessionItemBase {
  kind: "tool_call";
  toolCallId: string;
  name: string;
  args: JsonValue;
  /** Text content of the tool result; `null` while the tool is still running. */
  result: string | null;
  /** True when the server cut `result` at its size cap. */
  resultTruncated: boolean;
  isError: boolean;
  /** Tool result time minus the assistant entry's persist time (approximate for parallel calls); `null` while running. */
  durationMs: number | null;
}

/** `retry`: a failed model call pi retried (removed from context by a later `context_edit`); `error`: a final failure. */
export type SessionSystemEvent = "compaction" | "revive" | "retry" | "error" | "model_change";

/** Rendered as one centered muted line; `error` is pink. */
export interface SessionSystemItem extends SessionItemBase {
  kind: "system";
  event: SessionSystemEvent;
  text: string;
}

export type SessionItem =
  | SessionUserItem
  | SessionSwarmMessageItem
  | SessionAssistantTextItem
  | SessionThinkingItem
  | SessionToolCallItem
  | SessionSystemItem;

// Typed access to node:sqlite rows and the row → record mappers. snake_case never leaves src/store.
import type { SQLOutputValue } from "node:sqlite";
import type {
  AgentActivity,
  CommentView,
  ParticipantKind,
  ParticipantStatus,
  PostSummary,
  RecipientStatus,
  RecipientView,
  SwarmStatus,
} from "../api-types.js";

export type Row = Record<string, SQLOutputValue>;

export function int(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Column ${key} is not a number`);
}

/** REAL columns (cost). */
export function real(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new Error(`Column ${key} is not a number`);
}

export function intOrNull(row: Row, key: string): number | null {
  return row[key] === null ? null : int(row, key);
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`Column ${key} is not text`);
}

export function textOrNull(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

/** Row id and change counts may come back as bigint. */
export function count(value: number | bigint): number {
  return Number(value);
}

/** For `WHERE x IN (SELECT value FROM json_each(?))`, so id lists bind as one parameter. */
export function jsonList(values: readonly (number | string)[]): string {
  return JSON.stringify(values);
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`Unexpected ${what}: ${value}`);
  return found;
}

const SWARM_STATUSES: readonly SwarmStatus[] = ["starting", "running", "finished", "stopped", "interrupted"];
const KINDS: readonly ParticipantKind[] = ["agent", "user", "main", "system"];
const AGENT_STATUSES: readonly ParticipantStatus[] = ["pending", "starting", "working", "idle", "crashed", "stopped"];
const RECIPIENT_STATUSES: readonly RecipientStatus[] = ["pending", "delivered", "read", "undeliverable"];

export const swarmStatusOf = (row: Row, key = "status"): SwarmStatus => oneOf(SWARM_STATUSES, text(row, key), key);
export const kindOf = (row: Row, key = "kind"): ParticipantKind => oneOf(KINDS, text(row, key), key);
export const agentStatusOf = (row: Row, key = "status"): ParticipantStatus =>
  oneOf(AGENT_STATUSES, text(row, key), key);
export const recipientStatusOf = (row: Row, key = "status"): RecipientStatus =>
  oneOf(RECIPIENT_STATUSES, text(row, key), key);

export function activityOf(row: Row): AgentActivity | null {
  const raw = textOrNull(row, "activity");
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("kind" in value)) return null;
  if (value.kind === "thinking" || value.kind === "writing") return { kind: value.kind };
  if (value.kind === "tool" && "toolName" in value && typeof value.toolName === "string") {
    return { kind: "tool", toolName: value.toolName };
  }
  return null;
}

/** Expects a `comment_count` column. */
export function postOf(row: Row): PostSummary {
  return {
    id: int(row, "id"),
    swarmId: int(row, "swarm_id"),
    author: text(row, "author"),
    title: text(row, "title"),
    text: text(row, "body"),
    commentCount: int(row, "comment_count"),
    createdAt: int(row, "created_at"),
  };
}

export function commentOf(row: Row): CommentView {
  return {
    id: int(row, "id"),
    postId: int(row, "post_id"),
    swarmId: int(row, "swarm_id"),
    author: text(row, "author"),
    text: text(row, "body"),
    createdAt: int(row, "created_at"),
  };
}

export function recipientOf(row: Row): RecipientView {
  return {
    name: text(row, "name"),
    status: recipientStatusOf(row),
    deliveredAt: intOrNull(row, "delivered_at"),
    readAt: intOrNull(row, "read_at"),
  };
}

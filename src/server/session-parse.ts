// Turns pi session JSONL lines into Work-tab items. Pure: no fs, so paging and tests share it.
import type { JsonValue, SessionItem, SessionSystemEvent } from "../api-types.js";
import { REVIVE_PROMPT_HEADER } from "../constants.js";
import { parseDeliveredMessages } from "../message-format.js";

type AssistantBlock =
  | { kind: "text"; index: number; text: string }
  | { kind: "thinking"; index: number; text: string }
  | { kind: "toolCall"; index: number; id: string; name: string; args: JsonValue };

/** The entry shapes the Work tab shows or needs for joining; everything else is `other`. */
export type SessionEntry =
  | { kind: "user"; id: string; timestamp: number; text: string }
  | {
      kind: "assistant";
      id: string;
      timestamp: number;
      blocks: AssistantBlock[];
      blockCount: number;
      stopReason: string;
      errorMessage: string | null;
    }
  | { kind: "toolResult"; toolCallId: string; text: string; isError: boolean; endedAt: number }
  | { kind: "contextEdit"; targetId: string; removes: boolean }
  | { kind: "compaction"; id: string; timestamp: number; tokensBefore: number | null }
  | { kind: "modelChange"; id: string; timestamp: number; model: string; initial: boolean }
  | { kind: "other" };

/** What later entries say about earlier ones: tool results by call id and retried (removed) error turns. */
export interface EntryEffects {
  results: Map<string, { text: string; isError: boolean; endedAt: number }>;
  retried: Set<string>;
}

const OTHER: SessionEntry = { kind: "other" };
const ERROR_FALLBACK = "Model call failed";
const ABORTED_FALLBACK = "Request was aborted";
const REVIVE_TEXT = "Restarted after a crash or stall";

function prop(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJson(item);
    return out;
  }
  return null;
}

/** Text blocks of a user or tool result `content` (string or block array), joined by newlines. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const text = prop(block, "type") === "text" ? str(prop(block, "text")) : undefined;
    if (text !== undefined) parts.push(text);
  }
  return parts.join("\n");
}

function assistantBlocks(content: unknown): AssistantBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  content.forEach((block: unknown, index) => {
    const type = prop(block, "type");
    if (type === "text") {
      const text = str(prop(block, "text")) ?? "";
      if (text.trim()) blocks.push({ kind: "text", index, text });
    } else if (type === "thinking") {
      const text = str(prop(block, "thinking")) ?? "";
      if (prop(block, "redacted") !== true && text.trim()) blocks.push({ kind: "thinking", index, text });
    } else if (type === "toolCall") {
      const id = str(prop(block, "id")) ?? "";
      const name = str(prop(block, "name")) ?? "";
      blocks.push({ kind: "toolCall", index, id, name, args: toJson(prop(block, "arguments") ?? {}) });
    }
  });
  return blocks;
}

function parseMessage(id: string, timestamp: number, message: unknown): SessionEntry {
  const role = prop(message, "role");
  if (role === "user") return { kind: "user", id, timestamp, text: contentText(prop(message, "content")) };
  if (role === "toolResult") {
    return {
      kind: "toolResult",
      toolCallId: str(prop(message, "toolCallId")) ?? "",
      text: contentText(prop(message, "content")),
      isError: prop(message, "isError") === true,
      endedAt: num(prop(message, "timestamp")) ?? Number.NaN,
    };
  }
  if (role !== "assistant") return OTHER;
  const content = prop(message, "content");
  return {
    kind: "assistant",
    id,
    timestamp,
    blocks: assistantBlocks(content),
    blockCount: Array.isArray(content) ? content.length : 0,
    stopReason: str(prop(message, "stopReason")) ?? "",
    errorMessage: str(prop(message, "errorMessage")) ?? null,
  };
}

/** Parses one JSONL line; malformed lines and unknown types become `other` so paging never fails on them. */
export function parseEntry(line: string): SessionEntry {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return OTHER;
  }
  const id = str(prop(raw, "id")) ?? "";
  const timestamp = Date.parse(str(prop(raw, "timestamp")) ?? "");
  switch (prop(raw, "type")) {
    case "message":
      return parseMessage(id, timestamp, prop(raw, "message"));
    case "context_edit":
      return {
        kind: "contextEdit",
        targetId: str(prop(raw, "targetId")) ?? "",
        removes: prop(raw, "replacement") === null,
      };
    case "compaction":
      return { kind: "compaction", id, timestamp, tokensBefore: num(prop(raw, "tokensBefore")) ?? null };
    case "model_change": {
      const model = [str(prop(raw, "provider")), str(prop(raw, "modelId"))].filter(Boolean).join("/");
      // pi writes the starting model as the root entry; only later switches are news.
      return { kind: "modelChange", id, timestamp, model, initial: prop(raw, "parentId") === null };
    }
    default:
      return OTHER;
  }
}

export function emptyEffects(): EntryEffects {
  return { results: new Map(), retried: new Set() };
}

export function collectEffects(entries: Iterable<SessionEntry>, effects: EntryEffects = emptyEffects()): EntryEffects {
  for (const entry of entries) {
    if (entry.kind === "toolResult") {
      effects.results.set(entry.toolCallId, { text: entry.text, isError: entry.isError, endedAt: entry.endedAt });
    } else if (entry.kind === "contextEdit" && entry.removes) {
      effects.retried.add(entry.targetId);
    }
  }
  return effects;
}

/** True when `effects` carries a result or a retry mark for this entry. */
export function isAffected(entry: SessionEntry, effects: EntryEffects): boolean {
  if (entry.kind !== "assistant") return false;
  return (
    effects.retried.has(entry.id) ||
    entry.blocks.some((block) => block.kind === "toolCall" && effects.results.has(block.id))
  );
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  // Never leave half of a surrogate pair at the cut.
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return { text: text.slice(0, end), truncated: true };
}

function system(id: string, timestamp: number, event: SessionSystemEvent, text: string): SessionItem {
  return { kind: "system", id, timestamp, event, text };
}

function userItems(entry: Extract<SessionEntry, { kind: "user" }>): SessionItem[] {
  const { messages, rest } = parseDeliveredMessages(entry.text);
  const items: SessionItem[] = [];
  const nextId = () => `${entry.id}:${items.length}`;
  if (rest.startsWith(REVIVE_PROMPT_HEADER)) items.push(system(nextId(), entry.timestamp, "revive", REVIVE_TEXT));
  else if (rest) items.push({ kind: "user", id: nextId(), timestamp: entry.timestamp, text: rest });
  for (const message of messages) {
    items.push({ kind: "swarm_message", id: nextId(), timestamp: entry.timestamp, ...message });
  }
  return items;
}

function assistantItems(
  entry: Extract<SessionEntry, { kind: "assistant" }>,
  effects: EntryEffects,
  maxToolOutputChars: number,
): SessionItem[] {
  const { id, timestamp } = entry;
  const items = entry.blocks.map((block): SessionItem => {
    const blockId = `${id}:${block.index}`;
    if (block.kind === "text") return { kind: "assistant_text", id: blockId, timestamp, text: block.text };
    if (block.kind === "thinking") return { kind: "thinking", id: blockId, timestamp, text: block.text };
    const result = effects.results.get(block.id);
    const output = result ? truncate(result.text, maxToolOutputChars) : null;
    const durationMs = result ? result.endedAt - timestamp : Number.NaN;
    return {
      kind: "tool_call",
      id: blockId,
      timestamp,
      toolCallId: block.id,
      name: block.name,
      args: block.args,
      result: output ? output.text : null,
      resultTruncated: output ? output.truncated : false,
      isError: result ? result.isError : false,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
    };
  });
  const endId = `${id}:${entry.blockCount}`;
  if (entry.stopReason === "error") {
    const event = effects.retried.has(id) ? "retry" : "error";
    items.push(system(endId, timestamp, event, entry.errorMessage ?? ERROR_FALLBACK));
  } else if (entry.stopReason === "aborted") {
    items.push(system(endId, timestamp, "error", entry.errorMessage ?? ABORTED_FALLBACK));
  }
  return items;
}

/** The entry's items in entry order; `effects` must cover every entry after it up to the next assistant turn. */
export function entryItems(entry: SessionEntry, effects: EntryEffects, maxToolOutputChars: number): SessionItem[] {
  switch (entry.kind) {
    case "user":
      return userItems(entry);
    case "assistant":
      return assistantItems(entry, effects, maxToolOutputChars);
    case "compaction": {
      const tokens =
        entry.tokensBefore === null ? "" : ` (${entry.tokensBefore.toLocaleString("en-US")} tokens summarized)`;
      return [system(`${entry.id}:0`, entry.timestamp, "compaction", `Context compacted${tokens}`)];
    }
    case "modelChange":
      return entry.initial
        ? []
        : [system(`${entry.id}:0`, entry.timestamp, "model_change", `Model changed to ${entry.model}`)];
    default:
      return [];
  }
}

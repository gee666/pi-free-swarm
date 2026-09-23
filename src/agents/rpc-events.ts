// Pure readers for pi's RPC JSONL records (docs/pi-findings.md §2, §5, §8).
import { StringDecoder } from "node:string_decoder";
import type { AgentActivity } from "../api-types.js";
import { AGENT_TOOL } from "../constants.js";
import { findMessageIds } from "../message-format.js";
import type { UsageSample } from "../runtime-types.js";

export type RpcRecord = Record<string, unknown>;

/** Only headers outside quoted message bodies can acknowledge delivery. */
export function headerMessageIds(text: string): number[] {
  const ids: number[] = [];
  let inBody = false;
  for (const line of text.split("\n")) {
    if (inBody) {
      if (line.startsWith(`(reply with ${AGENT_TOOL.replyTo}(`)) inBody = false;
      continue;
    }
    if (line.startsWith('"')) {
      inBody = true;
      continue;
    }
    if (line.startsWith("[swarm message #")) ids.push(...findMessageIds(line.slice(0, line.indexOf("]") + 1)));
  }
  return ids;
}

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

function isRecord(value: unknown): value is RpcRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Malformed or non-object lines are dropped so they never interrupt the stream. */
export function parseRpcLine(line: string): RpcRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Splits on "\n" only: readline also splits on U+2028/U+2029, which JSON strings may contain. */
export function createJsonlSplitter(onLine: (line: string) => void): { push(chunk: Buffer): void; end(): void } {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const emit = (line: string) => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.length > 0) onLine(clean);
  };
  return {
    push(chunk) {
      buffer += decoder.write(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) emit(line);
    },
    end() {
      buffer += decoder.end();
      const rest = buffer;
      buffer = "";
      emit(rest);
    },
  };
}

function usageSample(kind: UsageSample["kind"], usage: RpcRecord, model: string | null): UsageSample {
  return {
    kind,
    input: numberOrZero(usage.input),
    output: numberOrZero(usage.output),
    cacheRead: numberOrZero(usage.cacheRead),
    cacheWrite: numberOrZero(usage.cacheWrite),
    cost: numberOrZero(isRecord(usage.cost) ? usage.cost.total : undefined),
    model,
  };
}

/** Assistant `message_start` carries a partial usage, so only `message_end` counts. */
export function extractUsage(event: RpcRecord): UsageSample | null {
  if (event.type === "message_end" && isRecord(event.message) && event.message.role === "assistant") {
    const { usage, model } = event.message;
    if (!isRecord(usage)) return null;
    return usageSample("message", usage, typeof model === "string" && model.length > 0 ? model : null);
  }
  if (event.type === "compaction_end" && isRecord(event.result) && isRecord(event.result.usage)) {
    return usageSample("compaction", event.result.usage, null);
  }
  return null;
}

export function extractUserText(event: RpcRecord): string | null {
  if (event.type !== "message_start" || !isRecord(event.message) || event.message.role !== "user") return null;
  const { content } = event.message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter(isRecord).flatMap((block) => (typeof block.text === "string" ? [block.text] : []));
  return texts.join("\n");
}

export function activityOf(event: RpcRecord): AgentActivity | null | undefined {
  switch (event.type) {
    case "message_update": {
      const kind = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent.type : undefined;
      if (kind === "thinking_start") return { kind: "thinking" };
      if (kind === "text_start") return { kind: "writing" };
      return undefined;
    }
    case "tool_execution_start":
      return typeof event.toolName === "string" ? { kind: "tool", toolName: event.toolName } : undefined;
    case "tool_execution_end":
      return { kind: "writing" };
    case "agent_settled":
      return null;
    default:
      return undefined;
  }
}

/** Dialogs block the child until answered; notify/setStatus and other UI records need no answer. */
export function dialogRequestId(event: RpcRecord): string | null {
  if (event.type !== "extension_ui_request" || typeof event.id !== "string") return null;
  return typeof event.method === "string" && DIALOG_METHODS.has(event.method) ? event.id : null;
}

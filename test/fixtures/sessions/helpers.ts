// Builders for synthetic pi session lines in the real format (see the *.jsonl fixtures beside this file).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionItem } from "../../../src/api-types.js";
import { SessionReader } from "../../../src/server/sessions.js";

export const FIXTURES = path.dirname(fileURLToPath(import.meta.url));

export function tempDir(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-sessions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const BASE_MS = Date.parse("2026-09-24T09:00:00.000Z");
const USAGE = { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { total: 0.0002 } };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function line(entry: object): string {
  return `${JSON.stringify(entry)}\n`;
}

export function headerLine(): string {
  return line({
    type: "session",
    version: 3,
    id: "01a0ce10-0000-7000-8000-000000000000",
    timestamp: iso(BASE_MS),
    cwd: "/p",
  });
}

export function userLine(id: string, text: string, at = BASE_MS): string {
  const message = { role: "user", content: [{ type: "text", text }], timestamp: at };
  return line({ type: "message", id, parentId: null, timestamp: iso(at), message });
}

export function assistantLine(id: string, content: object[], at = BASE_MS, extra: object = {}): string {
  const message = { role: "assistant", content, provider: "anthropic", model: "m", usage: USAGE, stopReason: "stop" };
  return line({
    type: "message",
    id,
    parentId: null,
    timestamp: iso(at),
    message: { ...message, timestamp: at, ...extra },
  });
}

export function toolCall(id: string, name = "bash", args: object = { command: "ls", timeout: 60 }): object {
  return { type: "toolCall", id, name, arguments: args };
}

export function toolResultLine(id: string, callId: string, text: string, at = BASE_MS, isError = false): string {
  const message = {
    role: "toolResult",
    toolCallId: callId,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
  };
  return line({ type: "message", id, parentId: null, timestamp: iso(at), message: { ...message, timestamp: at } });
}

export function errorLine(id: string, errorMessage: string, at = BASE_MS): string {
  return assistantLine(id, [], at, { stopReason: "error", errorMessage });
}

export function contextEditLine(id: string, targetId: string): string {
  return line({ type: "context_edit", id, parentId: targetId, timestamp: iso(BASE_MS), targetId, replacement: null });
}

export function customLine(id: string): string {
  return line({
    type: "custom",
    customType: "display-time",
    data: { text: "tick" },
    id,
    parentId: null,
    timestamp: iso(BASE_MS),
  });
}

/** A turn of four entries (prompt, tool call, tool result, answer) producing three items. */
export function turnLines(k: number): string {
  const at = BASE_MS + k * 1000;
  return (
    userLine(`u${k}`, `prompt ${k}`, at) +
    assistantLine(`c${k}`, [toolCall(`call-${k}`)], at + 100) +
    toolResultLine(`r${k}`, `call-${k}`, `output ${k}`, at + 350) +
    assistantLine(`a${k}`, [{ type: "text", text: `answer ${k}` }], at + 500)
  );
}

/** Item ids of `turns` turns, newest first, as the reader must return them. */
export function turnItemIds(turns: number): string[] {
  const ids: string[] = [];
  for (let k = turns - 1; k >= 0; k--) ids.push(`a${k}:0`, `c${k}:0`, `u${k}:0`);
  return ids;
}

/** Walks every `before` page from the newest one; returns items newest first. */
export async function readAllPages(reader: SessionReader, file: string, limit: number): Promise<SessionItem[]> {
  const items: SessionItem[] = [];
  let before: string | undefined;
  do {
    const page = await reader.readPage("Maria", file, { before, limit });
    items.push(...page.items);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined);
  return items;
}

import type { JsonValue } from "../../../../src/api-types";
import { formatDuration } from "../../lib/format";

/** Arguments and output show this much until "Show more" (the server already caps output at 64 KB). */
export const TOOL_TEXT_PREVIEW_CHARS = 4 * 1024;

// Keeps a pathological argument (e.g. a whole file for `write`) from bloating a one-line header.
const SUMMARY_MAX_CHARS = 200;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_CHARS);

/** Header summary of a call: its first string argument (command, path, …), else compact JSON. */
export function argsSummary(args: JsonValue): string {
  if (typeof args === "string") return oneLine(args);
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    const first = Object.values(args).find((value) => typeof value === "string");
    if (typeof first === "string") return oneLine(first);
  }
  return oneLine(JSON.stringify(args));
}

/** Arguments as shown in the expanded call. */
export function argsText(args: JsonValue): string {
  return typeof args === "string" ? args : JSON.stringify(args, null, 2);
}

/** First non-empty line, for collapsed thinking. */
export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "";
}

/** "40ms" for quick calls, then the shared "12s" / "1m 05s" format. */
export function formatToolDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms);
}

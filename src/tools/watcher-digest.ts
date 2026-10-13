import type { JsonValue, SessionItem } from "../api-types.js";
import { WATCHER_ARGS_MAX, WATCHER_TEXT_MAX } from "../constants.js";
import { charCount, clipWithSuffix } from "../limits.js";

export function compactText(text: string, max = WATCHER_TEXT_MAX): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return charCount(compact) <= max ? compact : clipWithSuffix(compact, "…", max);
}

function shortArgs(args: JsonValue): string {
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    for (const key of ["path", "file_path", "command", "agent", "thread_id", "post_id"]) {
      const value = args[key];
      if (typeof value === "string" || typeof value === "number") return compactText(String(value), WATCHER_ARGS_MAX);
    }
  }
  return compactText(JSON.stringify(args), WATCHER_ARGS_MAX);
}

export function activityLine(item: SessionItem): string | null {
  switch (item.kind) {
    case "assistant_text":
      return `assistant: ${compactText(item.text)}`;
    case "tool_call":
      return `${item.isError ? "ERROR " : ""}tool: ${item.name} ${shortArgs(item.args)}`;
    case "system":
      return item.event === "error" || item.event === "retry" ? `${item.event}: ${compactText(item.text)}` : null;
    default:
      return null;
  }
}

export function formatActivity(items: readonly SessionItem[]): string {
  return (
    items
      .flatMap((item) => {
        const line = activityLine(item);
        return line === null ? [] : [`${new Date(item.timestamp).toISOString()} ${line}`];
      })
      .join("\n") || "No assistant activity in this page."
  );
}

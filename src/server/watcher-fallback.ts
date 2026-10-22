import type { ThreadResponse, WatcherResponse } from "../api-types.js";
import { USER_NAME, WATCHER_NAME } from "../constants.js";
import { headerMessageIds } from "../agents/rpc-events.js";
import type { SessionEntry } from "./session-parse.js";

/** A session answer is evidence, not a fabricated message or a retry of a failed write. */
export function watcherFallback(thread: ThreadResponse, entries: readonly SessionEntry[]): WatcherResponse["fallback"] {
  const question = [...thread.messages].reverse().find((message) => message.sender === USER_NAME);
  if (!question || thread.messages.some((message) => message.sender === WATCHER_NAME && message.id > question.id)) {
    return undefined;
  }
  let start = -1;
  entries.forEach((entry, index) => {
    if (entry.kind === "user" && headerMessageIds(entry.text).includes(question.id)) start = index;
  });
  if (start < 0) return undefined;
  const turn = entries.slice(start + 1).reverse();
  const failure = turn.find((entry) => entry.kind === "toolResult" && entry.isError);
  const error = failure?.kind === "toolResult" ? failure.text : null;
  const answer = turn.find((entry) => entry.kind === "assistant" && entry.stopReason !== "toolUse");
  const text =
    answer?.kind === "assistant"
      ? answer.blocks
          .filter((block) => block.kind === "text")
          .map((block) => block.text)
          .join("\n")
      : "";
  const modelError = answer?.kind === "assistant" ? answer.errorMessage : null;
  if (!text && !error && !modelError) return undefined;
  return { questionId: question.id, text, error: error ?? modelError };
}

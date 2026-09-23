// Turns RPC events into watchdog activity and supervisor callbacks, independent of JSONL framing.
// `response` records never reach this handler: AgentProcess correlates them with their commands.
import type { AgentActivity } from "../api-types.js";
import { RETRY_WAIT_GRACE_MS } from "../constants.js";
import type { UsageSample } from "../runtime-types.js";
import { activityOf, extractUsage, extractUserText, type RpcRecord } from "./rpc-events.js";
import type { StallWatchdog } from "./watchdog.js";

export interface ProtocolHandlers {
  onRunStart(): void;
  /** Every agent_settled; the supervisor decides whether it counts. */
  onSettled(): void;
  onUserMessage(text: string): void;
  onUsage(sample: UsageSample): void;
  onActivity(activity: AgentActivity | null): void;
}

/** Events that prove the agent made progress. */
const SEMANTIC_EVENT_TYPES = new Set([
  "message_end",
  "tool_result_end",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
]);

/** Streaming and housekeeping events that also count as activity once the first turn happened. */
const STREAMING_EVENT_TYPES = new Set([
  "message_update",
  "tool_execution_update",
  "auto_retry_end",
  "compaction_start",
  "compaction_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
]);

function isAssistantMessageEnd(event: RpcRecord): boolean {
  const message = event.message;
  return (
    event.type === "message_end" &&
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant"
  );
}

export function createProtocolHandler(watchdog: StallWatchdog, handlers: ProtocolHandlers): (event: RpcRecord) => void {
  return (event) => {
    const type = event.type;
    if (typeof type !== "string") return;

    const activity = activityOf(event);
    if (activity !== undefined) handlers.onActivity(activity);
    const usage = extractUsage(event);
    if (usage) handlers.onUsage(usage);
    const userText = extractUserText(event);
    if (userText !== null) handlers.onUserMessage(userText);

    if (type === "agent_start") {
      watchdog.rearm();
      handlers.onRunStart();
      return;
    }
    // Swarm agents stay alive while idle: settling disarms every timer instead of ending the child.
    if (type === "agent_settled") {
      watchdog.disarm();
      handlers.onSettled();
      return;
    }
    // Only a run boundary: pi may now auto-retry, compact and retry, or run a queued continuation.
    if (type === "agent_end") {
      watchdog.noteActivity(event.willRetry === true ? RETRY_WAIT_GRACE_MS : 0);
      return;
    }
    if (type === "auto_retry_start") {
      const delayMs = typeof event.delayMs === "number" && Number.isFinite(event.delayMs) ? event.delayMs : 0;
      watchdog.noteActivity(Math.max(0, delayMs) + RETRY_WAIT_GRACE_MS);
      return;
    }

    if (SEMANTIC_EVENT_TYPES.has(type)) {
      if (type === "turn_start" || isAssistantMessageEnd(event)) watchdog.noteFirstTurn();
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      if (type === "tool_execution_start" && toolCallId) watchdog.toolStarted(toolCallId);
      else if (type === "tool_execution_end" && toolCallId) watchdog.toolEnded(toolCallId);
      else watchdog.noteActivity();
      return;
    }
    if (STREAMING_EVENT_TYPES.has(type)) watchdog.noteActivity();
  };
}

import type { AgentActivity, ParticipantStatus } from "../api-types.js";
import type { UsageSample } from "../runtime-types.js";

export interface PromptPayload {
  text: string;
  messageIds: readonly number[];
  /** Synchronous broker revalidation at the final write boundary. Null cancels an unsent payload. */
  beforeSend?(): PromptPayload | null;
  /** Full wall posts, covered only after their text enters context. */
  postIds?: readonly number[];
}

export type DeliveryOutcome = { accepted: true } | { accepted: false; error: string };

export interface AgentCrash {
  reason:
    | "exit"
    | "startup_timeout"
    | "inactivity"
    | "spawn_error"
    | "extension_load_failed"
    | "prompt_rejected"
    | "protocol_overflow";
  /** Deterministic failure: do not revive without a configuration change. */
  fatal: boolean;
  /** OS error code classification, never inferred from stderr. */
  sharedFailure?: "spawn-resource";
  /** Identical configuration command failed, independent of worker prompt content. */
  sharedStartupFailure?: "steering-mode";
  message: string;
  exitCode: number | null;
  signal: string | null;
  stderrTail: string;
}

export interface SupervisorHooks {
  onStatus(status: ParticipantStatus): void;
  /** First positive model-run signal for this process generation. */
  onReady?(): void;
  /** Authorized message markers observed in a user message_start. */
  onMessagesRead(messageIds: number[]): void;
  onPostsRead?(postIds: number[]): void;
  onUsage(sample: UsageSample): void;
  onActivity(activity: AgentActivity | null): void;
  /** After crashed status, never for stop(). */
  onCrash(crash: AgentCrash): void;
}

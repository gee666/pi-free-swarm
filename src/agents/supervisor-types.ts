import type { AgentActivity, ParticipantStatus } from "../api-types.js";
import type { UsageSample } from "../runtime-types.js";
import type { MessageObservation } from "./message-observation.js";
import type { RpcRecord } from "./rpc-events.js";
import type { AgentTransport } from "./transport.js";
import type { StallKind, StallWatchdog } from "./watchdog.js";

/** One process generation; all observation authorization dies with this state. */
export interface WorkerLife {
  proc: AgentTransport;
  watchdog: StallWatchdog;
  handle(event: RpcRecord): void;
  stall: { kind: StallKind; message: string } | null;
  promptsInFlight: number;
  deferredSettle: boolean;
  runStarts: number;
  messages: MessageObservation;
}

export interface PromptPayload {
  text: string;
  messageIds: readonly number[];
  /** Synchronous broker revalidation at the final write boundary. Null cancels an unsent payload. */
  beforeSend?(): PromptPayload | null;
}

export type DeliveryOutcome = { accepted: true } | { accepted: false; error: string; withdrawn?: true };

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
  sharedStartupFailure?: "steering-mode" | "launch-command";
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
  onUsage(sample: UsageSample): void;
  onActivity(activity: AgentActivity | null): void;
  /** After crashed status, never for stop(). */
  onCrash(crash: AgentCrash): void;
}

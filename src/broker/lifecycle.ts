// When a run is done (plan §7.6) and how long a crashed agent waits before its next revive (§7.7).
import type { ParticipantStatus } from "../api-types.js";
import type { Clock } from "../clock.js";
import { COMPLETION_GRACE_MS, REVIVE_BACKOFF_MS } from "../constants.js";

export interface AgentLiveness {
  status: ParticipantStatus;
  reviveScheduled: boolean;
  /** Also true after a fatal crash, which is never revived. */
  revivesExhausted: boolean;
}

export interface QuiescenceInput {
  /** The stagger is complete: every agent's first launch has been started. */
  allLaunched: boolean;
  agents: readonly AgentLiveness[];
  /** Pending or delivered-not-read agent recipients, not counting agents whose revives are exhausted. */
  openRecipients: number;
}

function isSettled(agent: AgentLiveness): boolean {
  if (agent.status === "idle") return true;
  return agent.status === "crashed" && agent.revivesExhausted && !agent.reviveScheduled;
}

export function isQuiescent(input: QuiescenceInput): boolean {
  return input.allLaunched && input.openRecipients === 0 && input.agents.every(isSettled);
}

/** The grace absorbs messages in flight and pi's auto-retry right after an `agent_end`. */
export class CompletionTracker {
  readonly #clock: Clock;
  readonly #graceMs: number;
  #quietSince: number | null = null;

  constructor(clock: Clock, graceMs: number = COMPLETION_GRACE_MS) {
    this.#clock = clock;
    this.#graceMs = graceMs;
  }

  /** True once quiescent continuously for the grace period; any break starts it over. */
  update(input: QuiescenceInput): boolean {
    if (!isQuiescent(input)) {
      this.#quietSince = null;
      return false;
    }
    const now = this.#clock.now();
    this.#quietSince ??= now;
    return now - this.#quietSince >= this.#graceMs;
  }

  /** Activity seen between two checks (a wake can go idle → working → idle faster than the check interval). */
  reset(): void {
    this.#quietSince = null;
  }
}

/** `null` = the agent's revive budget for this run is used up. */
export function reviveDelayMs(
  revivesUsedThisRun: number,
  backoffMs: readonly number[] = REVIVE_BACKOFF_MS,
): number | null {
  return backoffMs[revivesUsedThisRun] ?? null;
}

// Stall watchdog for one agent process. It kills an agent only when the model or RPC side stops
// responding, never for working long: tool runtimes are unbounded and an idle agent has no timer.
import type { Clock, TimerHandle } from "../clock.js";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_STARTUP_RETRIES,
  DEFAULT_STARTUP_TIMEOUT_MS,
  IDLE_TIMEOUT_ENV,
  STARTUP_RETRIES_ENV,
  STARTUP_TIMEOUT_ENV,
} from "../constants.js";

/** Milliseconds; 0 turns the respective timer off. */
export interface WatchdogConfig {
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  startupRetries: number;
}

export type StallKind = "startup" | "inactivity";

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function watchdogConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
  return {
    startupTimeoutMs: nonNegativeInt(env[STARTUP_TIMEOUT_ENV], DEFAULT_STARTUP_TIMEOUT_MS),
    idleTimeoutMs: nonNegativeInt(env[IDLE_TIMEOUT_ENV], DEFAULT_IDLE_TIMEOUT_MS),
    startupRetries: nonNegativeInt(env[STARTUP_RETRIES_ENV], DEFAULT_STARTUP_RETRIES),
  };
}

export class StallWatchdog {
  readonly #config: WatchdogConfig;
  readonly #clock: Clock;
  readonly #onStall: (kind: StallKind, message: string) => void;
  readonly #activeToolCallIds = new Set<string>();
  #startupTimer: TimerHandle | undefined;
  #idleTimer: TimerHandle | undefined;
  #receivedFirstTurn = false;
  #idleDeadline = 0;
  #settled = false;
  #fired = false;

  constructor(config: WatchdogConfig, clock: Clock, onStall: (kind: StallKind, message: string) => void) {
    this.#config = config;
    this.#clock = clock;
    this.#onStall = onStall;
  }

  /** Until the first model turn: catches cold-start hangs (slow extension load, wedged init). */
  armStartup(): void {
    const timeoutMs = this.#config.startupTimeoutMs;
    if (timeoutMs === 0 || this.#fired || this.#settled || this.#receivedFirstTurn) return;
    this.#startupTimer?.cancel();
    this.#startupTimer = this.#clock.after(timeoutMs, () => {
      if (this.#receivedFirstTurn) return;
      this.#fire("startup", `Agent startup timeout: no model turn after ${timeoutMs}ms.`);
    });
  }

  noteFirstTurn(): void {
    if (this.#receivedFirstTurn) return;
    this.#receivedFirstTurn = true;
    this.#cancelStartup();
  }

  noteActivity(minimumQuietMs = 0): void {
    this.#cancelIdle();
    const idleTimeoutMs = this.#config.idleTimeoutMs;
    if (!this.#receivedFirstTurn || idleTimeoutMs === 0 || this.#fired || this.#settled) return;
    // The window measures the agent, not its tools: a tool may be silent for longer than the timeout,
    // so stay disarmed until every concurrent execution ended (toolEnded restarts a full window).
    if (this.#activeToolCallIds.size > 0) return;
    this.#armIdle(Math.max(idleTimeoutMs, minimumQuietMs));
  }

  /**
   * Any stdout record, including extension UI notices, proves the process is alive. It renews the
   * configured window but never shortens a longer one, e.g. a retry grace; silence still stalls.
   */
  noteOutput(): void {
    if (this.#fired || this.#settled) return;
    if (!this.#receivedFirstTurn) {
      this.armStartup();
      return;
    }
    // Unarmed after the first turn means a tool runs or the timeout is off: output must not arm it.
    if (this.#idleTimer === undefined) return;
    const renewedMs = this.#config.idleTimeoutMs;
    if (this.#clock.now() + renewedMs <= this.#idleDeadline) return;
    this.#cancelIdle();
    this.#armIdle(renewedMs);
  }

  #armIdle(quietMs: number): void {
    this.#idleDeadline = this.#clock.now() + quietMs;
    this.#idleTimer = this.#clock.after(quietMs, () => {
      this.#fire("inactivity", `Agent inactivity timeout: no agent activity for ${quietMs}ms.`);
    });
  }

  toolStarted(toolCallId: string): void {
    this.#activeToolCallIds.add(toolCallId);
    this.#cancelIdle();
  }

  toolEnded(toolCallId: string): void {
    this.#activeToolCallIds.delete(toolCallId);
    this.noteActivity();
  }

  /** A settled agent waits for messages as long as needed, so nothing may fire until rearm(). */
  disarm(): void {
    this.#settled = true;
    this.#activeToolCallIds.clear();
    this.#cancelStartup();
    this.#cancelIdle();
  }

  rearm(): void {
    this.#settled = false;
    this.noteActivity();
  }

  #fire(kind: StallKind, message: string): void {
    this.#fired = true;
    this.#cancelStartup();
    this.#cancelIdle();
    this.#onStall(kind, message);
  }

  #cancelStartup(): void {
    this.#startupTimer?.cancel();
    this.#startupTimer = undefined;
  }

  #cancelIdle(): void {
    this.#idleTimer?.cancel();
    this.#idleTimer = undefined;
  }
}

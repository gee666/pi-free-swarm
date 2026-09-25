import type { RpcRecord } from "../../src/agents/rpc-events.js";

export function waitPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    ext: "0.6.0",
    event: "wait",
    waitId: "wait-1",
    reason: "rate-limit",
    message: "Waiting before retry",
    error: "HTTP 429",
    model: { provider: "provider", id: "model" },
    plannedDurationMs: 26 * 60_000,
    plannedDeadline: 2_560_000,
    startedAt: 1_000_000,
    remainingMs: 26 * 60_000,
    attempt: null,
    maxAttempts: null,
    livelinessIntervalMs: 15_000,
    controlFile: null,
    ...overrides,
  };
}

export function waitFrame(overrides: Record<string, unknown> = {}): RpcRecord {
  return statusFrame(JSON.stringify(waitPayload(overrides)));
}

export function statusFrame(statusText?: unknown): RpcRecord {
  return {
    type: "extension_ui_request",
    id: "status-1",
    method: "setStatus",
    statusKey: "oira666.pi-limits-wait.json",
    statusText,
  };
}

export function giveUpFrame(): RpcRecord {
  return waitFrame({
    event: "give_up",
    waitId: null,
    reason: null,
    plannedDurationMs: null,
    plannedDeadline: null,
    startedAt: null,
    remainingMs: null,
  });
}

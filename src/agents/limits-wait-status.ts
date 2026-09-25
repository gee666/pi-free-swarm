// Optional limits-wait RPC status v1; no dependency on the extension or its human-readable notices.
import type { RpcRecord } from "./rpc-events.js";

export type LimitsWaitStatus = { event: "wait" | "wait_end"; waitId: string } | { event: "give_up" | "clear" };

const STATUS_KEY = "oira666.pi-limits-wait.json";
const REASONS = new Set(["rate-limit", "overloaded", "authentication", "model-frozen", "network", "retry"]);
const OUTCOMES = new Set(["waited", "skipped", "aborted"]);
const NOTICE_MAX_CHARS = 500;

export function limitsWaitStatus(record: RpcRecord): LimitsWaitStatus | null {
  if (record.type !== "extension_ui_request" || record.method !== "setStatus" || record.statusKey !== STATUS_KEY) {
    return null;
  }
  if (record.statusText === undefined || record.statusText === "") return { event: "clear" };
  if (typeof record.statusText !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(record.statusText);
  } catch {
    return null;
  }
  if (!object(payload) || payload.v !== 1 || !nonempty(payload.ext) || !notice(payload.message)) return null;
  if (payload.error !== null && !notice(payload.error)) return null;
  if (!duration(payload.livelinessIntervalMs) || payload.livelinessIntervalMs === 0) return null;
  if (!attempt(payload.attempt) || !attempt(payload.maxAttempts)) return null;
  if (payload.controlFile !== null && !nonempty(payload.controlFile)) return null;
  if (payload.periodId !== undefined && !nonempty(payload.periodId)) return null;
  if (
    payload.model !== undefined &&
    (!object(payload.model) || !nonempty(payload.model.provider) || !nonempty(payload.model.id))
  )
    return null;
  if (
    payload.outcome !== undefined &&
    (payload.event !== "wait_end" || typeof payload.outcome !== "string" || !OUTCOMES.has(payload.outcome))
  )
    return null;
  if (payload.actualElapsedMs !== undefined && (payload.event !== "wait_end" || !duration(payload.actualElapsedMs)))
    return null;

  const timing = [payload.plannedDurationMs, payload.plannedDeadline, payload.startedAt, payload.remainingMs];
  if (payload.event === "give_up") {
    return payload.waitId === null && payload.reason === null && timing.every((value) => value === null)
      ? { event: "give_up" }
      : null;
  }
  if (payload.event !== "wait" && payload.event !== "wait_end") return null;
  if (!nonempty(payload.waitId) || typeof payload.reason !== "string" || !REASONS.has(payload.reason)) return null;
  if (!timing.every(duration)) return null;
  if (payload.event === "wait_end" && payload.remainingMs !== 0) return null;
  return { event: payload.event, waitId: payload.waitId };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function notice(value: unknown): value is string {
  return typeof value === "string" && Array.from(value).length <= NOTICE_MAX_CHARS && !/[\r\n]/.test(value);
}

function duration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function attempt(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1);
}

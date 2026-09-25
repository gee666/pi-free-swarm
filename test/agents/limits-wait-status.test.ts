import assert from "node:assert/strict";
import { test } from "node:test";
import { limitsWaitStatus } from "../../src/agents/limits-wait-status.js";
import { giveUpFrame, statusFrame, waitFrame, waitPayload } from "./limits-wait-fixture.js";

test("recognizes structured v1 wait, wait_end, give_up and blank/absent clear markers", () => {
  assert.deepEqual(limitsWaitStatus(waitFrame()), { event: "wait", waitId: "wait-1" });
  assert.deepEqual(
    limitsWaitStatus(waitFrame({ event: "wait_end", remainingMs: 0, outcome: "waited", actualElapsedMs: 123 })),
    { event: "wait_end", waitId: "wait-1" },
  );
  assert.deepEqual(limitsWaitStatus(giveUpFrame()), { event: "give_up" });
  for (const clear of [statusFrame(), statusFrame("")]) assert.deepEqual(limitsWaitStatus(clear), { event: "clear" });
  // Optional metadata and extension patch versions do not change schema v1.
  assert.deepEqual(
    limitsWaitStatus(waitFrame({ ext: "future", model: undefined, periodId: "period-1", extra: true })),
    { event: "wait", waitId: "wait-1" },
  );
});

test("ignores prose, notify, other extensions and malformed JSON without throwing", () => {
  const frame = waitFrame();
  for (const invalid of [
    { ...frame, statusKey: "oira666.pi-limits-wait" },
    { ...frame, statusKey: "unrelated.json" },
    { ...frame, method: "notify", notifyType: "info" },
    { ...frame, type: "custom" },
    ...[null, 4, "waiting 26 minutes", "{", "null", "[]", "true", "{}"].map(statusFrame),
  ])
    assert.equal(limitsWaitStatus(invalid), null);
});

test("rejects old/unknown schema versions and invalid v1 field types/ranges", () => {
  const invalid: Record<string, unknown>[] = [
    { v: 0 },
    { v: 2 },
    { v: "1" },
    { v: undefined },
    { ext: undefined },
    { event: "wait_start" },
    { waitId: null },
    { waitId: "" },
    { reason: null },
    { reason: "unknown" },
    { message: undefined },
    { message: "a\nb" },
    { message: "x".repeat(501) },
    { error: {} },
    { plannedDurationMs: null },
    { plannedDeadline: -1 },
    { startedAt: "now" },
    { remainingMs: -1 },
    { remainingMs: Infinity },
    { remainingMs: Number.MAX_VALUE },
    { livelinessIntervalMs: 0 },
    { livelinessIntervalMs: -1 },
    { livelinessIntervalMs: "15000" },
    { attempt: 0 },
    { attempt: 1.5 },
    { maxAttempts: undefined },
    { controlFile: false },
    { periodId: {} },
    { model: {} },
    { model: { provider: 1, id: "model" } },
    { outcome: "waited" },
    { actualElapsedMs: 1 },
    { event: "wait_end", remainingMs: 1 },
    { event: "wait_end", remainingMs: 0, outcome: "unknown" },
    { event: "wait_end", remainingMs: 0, outcome: ["waited"] },
    { event: "wait_end", remainingMs: 0, actualElapsedMs: -1 },
    { event: "give_up" },
  ];
  for (const overrides of invalid)
    assert.equal(limitsWaitStatus(waitFrame(overrides)), null, JSON.stringify(overrides));
  for (const field of Object.keys(waitPayload())) {
    if (field === "model") continue;
    assert.equal(limitsWaitStatus(waitFrame({ [field]: undefined })), null, `missing ${field}`);
  }
});

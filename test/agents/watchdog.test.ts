import assert from "node:assert/strict";
import { test } from "node:test";
import { createProtocolHandler, type ProtocolHandlers } from "../../src/agents/protocol.js";
import { StallWatchdog, watchdogConfigFromEnv, type StallKind } from "../../src/agents/watchdog.js";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_STARTUP_RETRIES,
  DEFAULT_STARTUP_TIMEOUT_MS,
  RETRY_WAIT_GRACE_MS,
} from "../../src/constants.js";
import { FakeClock } from "./fake-clock.js";

const IDLE = 1_000;
const STARTUP = 500;

function setup() {
  const clock = new FakeClock();
  const stalls: { kind: StallKind; message: string }[] = [];
  const watchdog = new StallWatchdog(
    { startupTimeoutMs: STARTUP, idleTimeoutMs: IDLE, startupRetries: 2 },
    clock,
    (kind, message) => stalls.push({ kind, message }),
  );
  const calls: string[] = [];
  const handlers: ProtocolHandlers = {
    onRunStart: () => calls.push("run"),
    onSettled: () => calls.push("settled"),
    onUserMessage: (text) => calls.push(`user:${text}`),
    onUsage: (sample) => calls.push(`usage:${sample.kind}`),
    onActivity: (activity) => calls.push(`activity:${activity?.kind ?? "null"}`),
  };
  const handle = createProtocolHandler(watchdog, handlers);
  const startRun = () => {
    watchdog.armStartup();
    handle({ type: "agent_start" });
    handle({ type: "turn_start" });
  };
  return { clock, stalls, watchdog, handle, calls, startRun };
}

test("config defaults and PI_SWARM_* overrides", () => {
  assert.deepEqual(watchdogConfigFromEnv({}), {
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    startupRetries: DEFAULT_STARTUP_RETRIES,
  });
  assert.deepEqual(
    watchdogConfigFromEnv({
      PI_SWARM_STARTUP_TIMEOUT: "300",
      PI_SWARM_IDLE_TIMEOUT: " 0 ",
      PI_SWARM_STARTUP_RETRIES: "-1",
    }),
    { startupTimeoutMs: 300, idleTimeoutMs: 0, startupRetries: DEFAULT_STARTUP_RETRIES },
  );
});

test("startup timeout fires without a first turn", () => {
  const { clock, stalls, watchdog } = setup();
  watchdog.armStartup();
  clock.advance(STARTUP - 1);
  assert.equal(stalls.length, 0);
  clock.advance(1);
  assert.deepEqual(stalls, [{ kind: "startup", message: `Agent startup timeout: no model turn after ${STARTUP}ms.` }]);
  clock.advance(IDLE * 10);
  assert.equal(stalls.length, 1);
});

test("turn_start cancels the startup timer and inactivity kills a silent agent", () => {
  const { clock, stalls, startRun } = setup();
  startRun();
  clock.advance(IDLE - 1);
  assert.equal(stalls.length, 0);
  clock.advance(1);
  assert.deepEqual(stalls, [
    { kind: "inactivity", message: `Agent inactivity timeout: no agent activity for ${IDLE}ms.` },
  ]);
});

test("streaming events restart the inactivity window", () => {
  const { clock, stalls, handle, startRun } = setup();
  startRun();
  for (const type of ["message_update", "tool_execution_update", "compaction_start", "compaction_end", "turn_end"]) {
    clock.advance(IDLE - 100);
    handle({ type });
  }
  assert.equal(stalls.length, 0);
  clock.advance(IDLE);
  assert.equal(stalls.length, 1);
});

test("the watchdog is disarmed while any tool executes", () => {
  const { clock, stalls, handle, startRun } = setup();
  startRun();
  handle({ type: "tool_execution_start", toolCallId: "a", toolName: "bash" });
  handle({ type: "tool_execution_start", toolCallId: "b", toolName: "read" });
  clock.advance(IDLE * 50);
  handle({ type: "tool_execution_end", toolCallId: "a" });
  clock.advance(IDLE * 50);
  assert.equal(stalls.length, 0, "one tool still running");
  handle({ type: "tool_execution_end", toolCallId: "b" });
  clock.advance(IDLE - 1);
  assert.equal(stalls.length, 0, "a full window after the last tool ended");
  clock.advance(1);
  assert.equal(stalls[0]?.kind, "inactivity");
});

test("settled agents have no timer for longer than any timeout; a wake prompt re-arms", () => {
  const { clock, stalls, watchdog, handle, calls, startRun } = setup();
  startRun();
  handle({ type: "agent_end", willRetry: false });
  handle({ type: "agent_settled" });
  assert.deepEqual(calls, ["run", "activity:null", "settled"]);
  assert.equal(clock.pending, 0);
  clock.advance(IDLE * 1_000);
  assert.equal(stalls.length, 0);
  watchdog.rearm();
  clock.advance(IDLE);
  assert.equal(stalls[0]?.kind, "inactivity");
});

test("agent_end with willRetry and auto_retry_start extend by the retry grace", () => {
  const { clock, stalls, handle, startRun } = setup();
  startRun();
  handle({ type: "agent_end", willRetry: true });
  clock.advance(RETRY_WAIT_GRACE_MS - 1);
  assert.equal(stalls.length, 0);
  handle({ type: "auto_retry_start", attempt: 1, delayMs: 2_000 });
  clock.advance(RETRY_WAIT_GRACE_MS + 2_000 - 1);
  assert.equal(stalls.length, 0);
  clock.advance(1);
  assert.equal(stalls[0]?.message, `Agent inactivity timeout: no agent activity for ${RETRY_WAIT_GRACE_MS + 2_000}ms.`);
});

test("protocol forwards usage, user text and activity", () => {
  const { handle, calls } = setup();
  handle({ type: "message_start", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  handle({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } });
  handle({ type: "message_end", message: { role: "assistant", usage: { input: 1, cost: { total: 0 } } } });
  handle({ type: "compaction_end", result: { usage: { input: 1 } } });
  assert.deepEqual(calls, ["user:hi", "activity:thinking", "usage:message", "usage:compaction"]);
});

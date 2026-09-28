import assert from "node:assert/strict";
import { test } from "node:test";
import { createProtocolHandler } from "../../src/agents/protocol.js";
import type { RpcRecord } from "../../src/agents/rpc-events.js";
import { StallWatchdog, type StallKind } from "../../src/agents/watchdog.js";
import { RETRY_WAIT_GRACE_MS } from "../../src/constants.js";
import { FakeClock } from "./fake-clock.js";

const STARTUP = 100;
const IDLE = 200;
const noop = () => undefined;

function setup(startupTimeoutMs = STARTUP, idleTimeoutMs = IDLE) {
  const clock = new FakeClock();
  const stalls: StallKind[] = [];
  const watchdog = new StallWatchdog({ startupTimeoutMs, idleTimeoutMs, startupRetries: 2 }, clock, (kind) =>
    stalls.push(kind),
  );
  const handle = createProtocolHandler(watchdog, {
    onRunStart: noop,
    onSettled: noop,
    onActivity: noop,
    onUsage: noop,
    onUserMessage: noop,
  });
  watchdog.armStartup();
  const firstTurn = () => {
    handle({ type: "agent_start" });
    handle({ type: "turn_start" });
  };
  return { clock, stalls, watchdog, handle, firstTurn };
}

/** Records no model event implies: another extension's notices, statuses and untyped output. */
const NOTICE: RpcRecord = {
  type: "extension_ui_request",
  id: "n",
  method: "notify",
  message: "still waiting",
  notifyType: "info",
};
const UNRELATED: RpcRecord[] = [
  NOTICE,
  { type: "extension_ui_request", id: "s", method: "setStatus", statusKey: "any-ext", statusText: "busy" },
  { type: "some_future_event" },
  { note: "untyped record" },
];

for (const phase of ["startup", "inactivity"] as const) {
  test(`a long ${phase} wait is kept alive by periodic unrelated output, and silence then stalls`, () => {
    const { clock, stalls, handle, firstTurn } = setup();
    if (phase === "inactivity") firstTurn();
    const windowMs = phase === "startup" ? STARTUP : IDLE;
    for (let round = 0; round < 25; round++) {
      for (const record of UNRELATED) {
        clock.advance(windowMs - 1);
        handle(record);
      }
    }
    assert.deepEqual(stalls, []);
    clock.advance(windowMs - 1);
    assert.deepEqual(stalls, []);
    clock.advance(1);
    assert.deepEqual(stalls, [phase]);
    handle(NOTICE);
    clock.advance(windowMs * 10);
    assert.deepEqual(stalls, [phase], "late output cannot resurrect a fired watchdog");
  });
}

test("a silent process still stalls in both phases", () => {
  const startup = setup();
  startup.clock.advance(STARTUP);
  assert.deepEqual(startup.stalls, ["startup"]);
  const idle = setup();
  idle.firstTurn();
  idle.clock.advance(IDLE);
  assert.deepEqual(idle.stalls, ["inactivity"]);
});

test("output before the first turn keeps the startup window, not the inactivity one", () => {
  const { clock, stalls, handle, firstTurn } = setup();
  clock.advance(STARTUP - 1);
  handle(NOTICE);
  assert.equal(clock.nextDelay(), STARTUP);
  clock.advance(STARTUP - 1);
  firstTurn();
  clock.advance(IDLE - 1);
  assert.deepEqual(stalls, []);
  clock.advance(1);
  assert.deepEqual(stalls, ["inactivity"]);
});

test("output renews the configured window but never shortens a longer retry grace", () => {
  const { clock, stalls, handle, firstTurn } = setup();
  firstTurn();
  handle({ type: "agent_end", willRetry: true });
  clock.advance(10);
  handle(NOTICE);
  assert.equal(clock.nextDelay(), RETRY_WAIT_GRACE_MS - 10);
  clock.advance(RETRY_WAIT_GRACE_MS - 10);
  assert.deepEqual(stalls, ["inactivity"]);
});

test("output never arms a timer while a tool runs, after settling, or with timeouts off", () => {
  const tool = setup();
  tool.firstTurn();
  tool.handle({ type: "tool_execution_start", toolCallId: "t" });
  for (const record of UNRELATED) tool.handle(record);
  assert.equal(tool.clock.pending, 0);

  const settled = setup();
  settled.firstTurn();
  settled.handle({ type: "agent_settled" });
  for (const record of UNRELATED) settled.handle(record);
  assert.equal(settled.clock.pending, 0);
  settled.clock.advance(IDLE * 100);
  assert.deepEqual(settled.stalls, []);

  const settledEarly = setup();
  settledEarly.handle({ type: "agent_settled" });
  for (const record of UNRELATED) settledEarly.handle(record);
  assert.equal(settledEarly.clock.pending, 0);

  for (const afterTurn of [false, true]) {
    const off = setup(0, 0);
    if (afterTurn) off.firstTurn();
    for (const record of UNRELATED) off.handle(record);
    assert.equal(off.clock.pending, 0);
  }
});

test("a stopped agent's watchdog ignores later output", () => {
  const { clock, stalls, handle, watchdog, firstTurn } = setup();
  firstTurn();
  watchdog.disarm(); // The supervisor does this on stop and on exit.
  for (const record of UNRELATED) handle(record);
  assert.equal(clock.pending, 0);
  clock.advance(IDLE * 100);
  assert.deepEqual(stalls, []);
});

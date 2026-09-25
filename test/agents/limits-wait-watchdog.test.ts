import assert from "node:assert/strict";
import { test } from "node:test";
import { createProtocolHandler } from "../../src/agents/protocol.js";
import { StallWatchdog, type StallKind } from "../../src/agents/watchdog.js";
import { DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_STARTUP_TIMEOUT_MS } from "../../src/constants.js";
import { FakeClock } from "./fake-clock.js";
import { giveUpFrame, statusFrame, waitFrame } from "./limits-wait-fixture.js";

const HEARTBEAT = 15_000;

function setup(startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
  const clock = new FakeClock();
  const stalls: StallKind[] = [];
  const callbacks: string[] = [];
  const watchdog = new StallWatchdog({ startupTimeoutMs, idleTimeoutMs, startupRetries: 2 }, clock, (kind) =>
    stalls.push(kind),
  );
  const handle = createProtocolHandler(watchdog, {
    onRunStart: () => callbacks.push("start"),
    onSettled: () => callbacks.push("settled"),
    onActivity: () => callbacks.push("activity"),
    onUsage: () => callbacks.push("usage"),
    onUserMessage: () => callbacks.push("user"),
  });
  watchdog.armStartup();
  const firstTurn = () => {
    handle({ type: "agent_start" });
    handle({ type: "turn_start" });
  };
  return { clock, stalls, callbacks, watchdog, handle, firstTurn };
}

for (const phase of ["startup", "inactivity"] as const) {
  test(`26-minute wait heartbeats preserve ${phase} liveness, but missing ticks still stall`, () => {
    const { clock, stalls, handle, firstTurn, callbacks } = setup();
    if (phase === "inactivity") firstTurn();
    const before = [...callbacks];
    for (let elapsed = 0; elapsed <= 26 * 60_000; elapsed += HEARTBEAT) {
      handle(waitFrame({ remainingMs: 26 * 60_000 - elapsed }));
      clock.advance(HEARTBEAT);
      assert.deepEqual(stalls, []);
    }
    assert.deepEqual(callbacks, before, "wait ticks are not semantic progress or user-facing activity");
    const quietMs = phase === "startup" ? DEFAULT_STARTUP_TIMEOUT_MS : DEFAULT_IDLE_TIMEOUT_MS;
    clock.advance(quietMs - HEARTBEAT - 1);
    assert.deepEqual(stalls, []);
    clock.advance(1);
    assert.deepEqual(stalls, [phase]);
    handle(waitFrame());
    clock.advance(quietMs * 2);
    assert.deepEqual(stalls, [phase], "a late heartbeat cannot resurrect a fired watchdog");
  });
}

for (const phase of ["startup", "inactivity"] as const) {
  for (const end of ["wait_end", "give_up", "clear"] as const) {
    test(`${end} during ${phase} allows one normal retry/terminal window, not a permanent exemption`, () => {
      const { clock, stalls, handle, firstTurn } = setup(100, 200);
      if (phase === "inactivity") firstTurn();
      handle(waitFrame());
      clock.advance(80);
      const frame =
        end === "wait_end"
          ? waitFrame({ event: "wait_end", remainingMs: 0 })
          : end === "give_up"
            ? giveUpFrame()
            : statusFrame();
      handle(frame);
      const timeout = phase === "startup" ? 100 : 200;
      clock.advance(timeout - 1);
      handle(frame);
      assert.deepEqual(stalls, []);
      clock.advance(1);
      assert.deepEqual(stalls, [phase], "replayed terminal frames do not renew the window");
    });
  }
}

test("a wait does not fake first-turn readiness; the real turn switches from startup to idle timeout", () => {
  const { clock, stalls, handle, firstTurn } = setup(100, 200);
  handle(waitFrame());
  clock.advance(90);
  handle(waitFrame());
  clock.advance(90);
  firstTurn();
  clock.advance(199);
  assert.deepEqual(stalls, []);
  clock.advance(1);
  assert.deepEqual(stalls, ["inactivity"]);
});

test("unrelated, malformed, old and unknown-version frames cannot keep a normal stall alive", () => {
  for (const phase of ["startup", "inactivity"]) {
    const { clock, stalls, handle, firstTurn } = setup(100, 100);
    if (phase === "inactivity") firstTurn();
    for (const frame of [
      waitFrame({ v: 0 }),
      waitFrame({ v: 2 }),
      waitFrame({ remainingMs: null }),
      statusFrame("broken"),
      { ...waitFrame(), statusKey: "oira666.pi-limits-wait" },
      { type: "extension_ui_request", method: "notify", notifyType: "info", message: "still alive" },
    ]) {
      clock.advance(10);
      handle(frame);
    }
    clock.advance(40);
    assert.deepEqual(stalls, [phase]);
  }
});

test("terminal or clear markers without an active wait do not renew ordinary stall timers", () => {
  for (const phase of ["startup", "inactivity"]) {
    const { clock, handle, stalls, firstTurn } = setup(100, 100);
    if (phase === "inactivity") firstTurn();
    clock.advance(90);
    handle(waitFrame({ event: "wait_end", remainingMs: 0 }));
    handle(giveUpFrame());
    handle(statusFrame(""));
    clock.advance(10);
    assert.deepEqual(stalls, [phase]);
  }
});

test("advertised deadlines/heartbeat intervals never grant arbitrary timer extensions", () => {
  const { clock, handle, stalls, firstTurn } = setup(100, 200);
  firstTurn();
  handle(
    waitFrame({
      remainingMs: Number.MAX_SAFE_INTEGER,
      livelinessIntervalMs: Number.MAX_SAFE_INTEGER,
      plannedDeadline: Number.MAX_SAFE_INTEGER,
    }),
  );
  assert.equal(clock.nextDelay(), 200);
  clock.advance(200);
  assert.deepEqual(stalls, ["inactivity"]);
});

test("an older wait's end does not finish or refresh the newer wait", () => {
  const { clock, handle, stalls, firstTurn } = setup(100, 200);
  firstTurn();
  handle(waitFrame());
  clock.advance(50);
  handle(waitFrame({ waitId: "wait-2" }));
  clock.advance(100);
  handle(waitFrame({ event: "wait_end", remainingMs: 0 }));
  clock.advance(100);
  assert.deepEqual(stalls, ["inactivity"]);
});

test("settle and process stop/exit disarm waits; late statuses never rearm them", () => {
  for (const ending of ["settled", "stopped", "exited"]) {
    const { clock, handle, watchdog, stalls, firstTurn } = setup(100, 200);
    firstTurn();
    handle(waitFrame());
    if (ending === "settled") handle({ type: "agent_settled" });
    else watchdog.disarm(); // The supervisor does this on both stop and exit.
    for (const frame of [
      waitFrame(),
      waitFrame({ event: "wait_end", remainingMs: 0 }),
      giveUpFrame(),
      statusFrame(""),
    ]) {
      handle(frame);
      assert.equal(clock.pending, 0);
      clock.advance(1_000_000);
    }
    assert.deepEqual(stalls, []);
    if (ending === "settled") {
      firstTurn();
      clock.advance(200);
      assert.deepEqual(stalls, ["inactivity"], "a real new run still re-arms normal stall detection");
    }
  }
});

test("startup settle and disabled timers stay disarmed when wait telemetry arrives", () => {
  const early = setup(100, 200);
  early.handle(waitFrame());
  early.handle({ type: "agent_settled" });
  early.watchdog.armStartup();
  early.handle(waitFrame());
  assert.equal(early.clock.pending, 0);
  for (const firstTurn of [false, true]) {
    const run = setup(0, 0);
    if (firstTurn) run.firstTurn();
    run.handle(waitFrame());
    run.handle(giveUpFrame());
    assert.equal(run.clock.pending, 0);
  }
});

test("provider telemetry preserves existing unbounded tool execution semantics", () => {
  const { clock, handle, stalls, firstTurn } = setup(100, 200);
  firstTurn();
  handle({ type: "tool_execution_start", toolCallId: "tool" });
  handle(waitFrame());
  handle(giveUpFrame());
  clock.advance(1_000_000);
  assert.deepEqual(stalls, []);
  handle({ type: "tool_execution_end", toolCallId: "tool" });
  clock.advance(200);
  assert.deepEqual(stalls, ["inactivity"]);
});

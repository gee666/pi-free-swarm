import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionTracker, isQuiescent, reviveDelayMs, type AgentLiveness } from "../../src/broker/lifecycle.js";
import { COMPLETION_GRACE_MS, REVIVE_BACKOFF_MS } from "../../src/constants.js";
import { FakeClock } from "../agents/fake-clock.js";

const idle: AgentLiveness = { status: "idle", reviveScheduled: false, revivesExhausted: false };
const quiet = { allLaunched: true, agents: [idle, idle], openRecipients: 0 };

describe("isQuiescent", () => {
  it("needs every agent launched, idle and no open recipients", () => {
    assert.equal(isQuiescent(quiet), true);
    assert.equal(isQuiescent({ ...quiet, allLaunched: false }), false);
    assert.equal(isQuiescent({ ...quiet, openRecipients: 1 }), false);
    for (const status of ["pending", "starting", "working", "stopped"] as const) {
      assert.equal(isQuiescent({ ...quiet, agents: [idle, { ...idle, status }] }), false, status);
    }
  });

  it("counts a crashed agent only once its revives are exhausted and none is scheduled", () => {
    const crashed: AgentLiveness = { status: "crashed", reviveScheduled: false, revivesExhausted: true };
    assert.equal(isQuiescent({ ...quiet, agents: [idle, crashed] }), true);
    assert.equal(isQuiescent({ ...quiet, agents: [idle, { ...crashed, revivesExhausted: false }] }), false);
    assert.equal(isQuiescent({ ...quiet, agents: [idle, { ...crashed, reviveScheduled: true }] }), false);
  });
});

describe("CompletionTracker", () => {
  it("fires only after the grace period of continuous quiescence", () => {
    const clock = new FakeClock();
    const tracker = new CompletionTracker(clock);
    assert.equal(tracker.update(quiet), false);
    clock.advance(COMPLETION_GRACE_MS - 1);
    assert.equal(tracker.update(quiet), false);
    clock.advance(1);
    assert.equal(tracker.update(quiet), true);
  });

  it("restarts the grace after any break, e.g. a late message", () => {
    const clock = new FakeClock();
    const tracker = new CompletionTracker(clock, 1_000);
    tracker.update(quiet);
    clock.advance(900);
    assert.equal(tracker.update({ ...quiet, openRecipients: 1 }), false);
    clock.advance(200);
    assert.equal(tracker.update(quiet), false, "quiet again only since now");
    clock.advance(999);
    assert.equal(tracker.update(quiet), false);
    clock.advance(1);
    assert.equal(tracker.update(quiet), true);
  });

  it("restarts the grace on activity seen between two checks", () => {
    const clock = new FakeClock();
    const tracker = new CompletionTracker(clock, 1_000);
    tracker.update(quiet);
    clock.advance(900);
    tracker.reset();
    clock.advance(100);
    assert.equal(tracker.update(quiet), false);
    clock.advance(1_000);
    assert.equal(tracker.update(quiet), true);
  });
});

describe("reviveDelayMs", () => {
  it("follows the backoff and returns null once the budget is used", () => {
    assert.deepEqual(
      [0, 1, 2, 3].map((used) => reviveDelayMs(used)),
      [...REVIVE_BACKOFF_MS, null],
    );
    assert.equal(reviveDelayMs(1, [5, 7]), 7);
    assert.equal(reviveDelayMs(2, [5, 7]), null);
  });
});

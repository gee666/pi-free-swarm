import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentProcess } from "../../src/agents/agent-process.js";
import { SIGKILL_TIMEOUT_MS } from "../../src/constants.js";
import { createFakePiRun, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { FakeClock } from "./fake-clock.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("cooperative stop completes without advancing the escalation clock or leaving timers", async () => {
  useFakePi();
  const fake = createFakePiRun({});
  const clock = new FakeClock();
  const proc = AgentProcess.spawn(fake.spec(), { onEvent() {}, onExit() {} }, clock);
  try {
    await proc.send({ type: "set_steering_mode", mode: "all" });
    await proc.stop();
    assert.equal(alive(Number(proc.pid)), false);
    assert.equal(clock.pending, 0);
  } finally {
    await proc.stop();
    fake.cleanup();
  }
});

test("leader and stdio close cannot cancel escalation for a TERM-ignoring same-group descendant", async () => {
  useFakePi();
  const fake = createFakePiRun({ startup: [{ type: "grandchild", ignoreSigterm: true }] });
  const clock = new FakeClock();
  let exits = 0;
  const proc = AgentProcess.spawn(
    fake.spec(),
    {
      onEvent() {},
      onExit() {
        exits++;
      },
    },
    clock,
  );
  let descendant: number | undefined;
  try {
    await proc.send({ type: "set_steering_mode", mode: "all" });
    descendant = Number(fake.log().find((entry) => entry.fake === "grandchild")?.pid);
    assert.ok(descendant > 0);
    let stopped = false;
    const stopping = proc.stop().then(() => {
      stopped = true;
    });
    await waitFor(() => !alive(Number(proc.pid)), "leader exited and was reaped");
    // Allow close/stdio callbacks to drain without advancing the cleanup deadline.
    await new Promise<void>((resolve) => setImmediate(resolve));
    clock.advance(SIGKILL_TIMEOUT_MS - 1);
    assert.equal(stopped, false);
    assert.equal(exits, 0);
    assert.ok(alive(descendant), "descendant ignored TERM after closing all inherited stdio");
    clock.advance(1);
    await waitFor(() => !alive(Number(descendant)), "descendant killed by escalation");
    clock.advance(clock.nextDelay() ?? 0);
    await stopping;
    assert.equal(alive(descendant), false);
    assert.equal(exits, 1);
    assert.equal(clock.pending, 0, "cleanup leaves no timers");
  } finally {
    if (descendant && alive(descendant)) process.kill(descendant, "SIGKILL");
    const stopping = proc.stop();
    clock.advance(SIGKILL_TIMEOUT_MS);
    await waitFor(() => !alive(Number(proc.pid)) && !alive(Number(descendant)), "cleanup completed");
    clock.advance(clock.nextDelay() ?? 0);
    await stopping;
    fake.cleanup();
  }
});

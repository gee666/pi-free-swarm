import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { spawnAgentProcess } from "../../src/agents/launch.js";
import { killAllAgentsSync } from "../../src/agents/process-registry.js";
import { SIGKILL_TIMEOUT_MS } from "../../src/constants.js";
import { createFakePiRun, SCENARIOS, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { FakeClock } from "./fake-clock.js";
import { prompt, superviseFake } from "./supervisor-helpers.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("stop sends SIGTERM to the group and escalates to SIGKILL after the timeout", async () => {
  const clock = new FakeClock();
  const agent = superviseFake(SCENARIOS.stubborn, { clock });
  try {
    await agent.supervisor.launch(agent.fake.spec(), prompt("go"));
    await agent.waitStatus("idle");
    const grandchild = agent.fake.log().find((record) => record.fake === "grandchild")?.pid;
    assert.equal(typeof grandchild, "number");
    const pid = Number(grandchild);
    assert.ok(isAlive(pid));

    let stopped = false;
    const stopping = agent.supervisor.stop().then(() => (stopped = true));
    assert.equal(agent.supervisor.status, "stopped");
    await waitFor(() => agent.fake.log().some((record) => record.fake === "signal"), "SIGTERM reached the fake");
    await waitFor(() => !isAlive(pid), "the grandchild died with its group");
    assert.equal(stopped, false, "the fake ignores SIGTERM");

    clock.advance(SIGKILL_TIMEOUT_MS);
    await stopping;
    assert.equal(agent.supervisor.stop(), agent.supervisor.stop(), "idempotent");
    assert.deepEqual(agent.recorded.statuses, ["starting", "working", "idle", "stopped"]);
    assert.deepEqual(agent.recorded.crashes, [], "stop is never a crash");
  } finally {
    await agent.cleanup();
  }
});

test("stop during a run resolves once the process is gone", async () => {
  const agent = superviseFake(SCENARIOS.longTool(10_000));
  try {
    await agent.supervisor.launch(agent.fake.spec(), prompt("go"));
    await waitFor(() => agent.recorded.activity.some((activity) => activity?.kind === "tool"), "tool started");
    const pid = Number(agent.fake.log()[0].pid);
    await agent.supervisor.stop();
    assert.equal(isAlive(pid), false);
    assert.deepEqual(agent.recorded.statuses, ["starting", "working", "stopped"]);
  } finally {
    await agent.cleanup();
  }
});

test("killAllAgentsSync SIGKILLs every registered agent group synchronously", async () => {
  useFakePi();
  const fake = createFakePiRun(SCENARIOS.stubborn);
  try {
    const proc = spawnAgentProcess(fake.spec());
    const exited = once(proc, "exit");
    await waitFor(() => fake.log().some((record) => record.fake === "grandchild"), "grandchild spawned");
    const grandchild = Number(fake.log().find((record) => record.fake === "grandchild")?.pid);
    killAllAgentsSync();
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, "SIGKILL");
    await waitFor(() => !isAlive(grandchild), "grandchild killed with the group");
  } finally {
    fake.cleanup();
  }
});

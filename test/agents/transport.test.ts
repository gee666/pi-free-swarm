import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { AgentProcess } from "../../src/agents/agent-process.js";
import { AgentSupervisor, type SupervisorHooks } from "../../src/agents/supervisor.js";
import type { RpcRecord } from "../../src/agents/rpc-events.js";
import { createFakePiRun, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG, superviseFake, prompt } from "./supervisor-helpers.js";

function recordHooks(trace: unknown[]): SupervisorHooks {
  return {
    onStatus: (value) => trace.push(["status", value]),
    onMessagesRead: (value) => trace.push(["read", value]),
    onUsage: (value) => trace.push(["usage", value]),
    onActivity: (value) => trace.push(["activity", value]),
    onCrash: (value) => trace.push(["crash", value]),
  };
}

// Replaying a real child trace catches fake event shape and lifecycle-order drift.
test("fake transport conforms to real fixture event/hook trace", async () => {
  useFakePi();
  const fixture = createFakePiRun({ batchRunOutput: true });
  const realTrace: unknown[] = [];
  const events: RpcRecord[] = [];
  const real = new AgentSupervisor({
    name: "Maria",
    watchdog: RELAXED_WATCHDOG,
    hooks: recordHooks(realTrace),
    transportFactory: (spec, handlers, clock) =>
      AgentProcess.spawn(
        spec,
        {
          onEvent: (event) => {
            events.push(event);
            handlers.onEvent(event);
          },
          onExit: handlers.onExit,
        },
        clock,
      ),
  });
  const fakeTrace: unknown[] = [];
  const fake = fakeTransportFactory();
  const replay = new AgentSupervisor({
    name: "Maria",
    watchdog: RELAXED_WATCHDOG,
    hooks: recordHooks(fakeTrace),
    transportFactory: fake.factory,
  });
  try {
    const payload = prompt("[swarm message #42] fixture", [42]);
    assert.deepEqual(await real.launch(fixture.spec(), payload), { accepted: true });
    await waitFor(() => real.status === "idle", "real fixture settles");
    const launching = replay.launch(fixture.spec(), payload);
    const transport = fake.instances[0];
    assert.ok(transport);
    assert.deepEqual(transport.commands[0], { type: "set_steering_mode", mode: "all" });
    transport.respond();
    await waitFor(() => transport.commands.length === 2, "prompt command");
    transport.respond();
    for (const event of events) transport.event(event);
    assert.deepEqual(await launching, { accepted: true });
    assert.deepEqual(fakeTrace, realTrace);
    await real.stop();
    await replay.stop();
    assert.deepEqual(fakeTrace, realTrace);
  } finally {
    await real.stop();
    await replay.stop();
    fixture.cleanup();
  }
});

test("real child adapter preserves a large valid Unicode record below the configured cap", async () => {
  const agent = superviseFake({ runs: [[{ type: "reply", text: "🙂漢字".repeat(200_000) }]] });
  try {
    assert.deepEqual(await agent.supervisor.launch(agent.fake.spec(), prompt("start")), { accepted: true });
    await agent.waitStatus("idle");
    assert.deepEqual(agent.recorded.crashes, []);
    assert.equal(agent.recorded.usage.length, 1);
  } finally {
    await agent.cleanup();
  }
});

test("fixture usage identity follows the assigned combined model argument", async () => {
  const agent = superviseFake({});
  const spec = agent.fake.spec();
  spec.context.model = { provider: "fixture-a", modelId: "family/model", thinkingLevel: "high" };
  try {
    assert.deepEqual(await agent.supervisor.launch(spec, prompt("start")), { accepted: true });
    await agent.waitStatus("idle");
    assert.equal(agent.recorded.usage[0]?.model, "family/model");
    const session = readFileSync(spec.sessionFile, "utf8");
    assert.ok(session.includes('"provider":"fixture-a"'));
    assert.ok(session.includes('"model":"family/model"'));
  } finally {
    await agent.cleanup();
  }
});

test("oversized real child RPC frame is isolated and fatal without deterministic retry", async () => {
  const bad = superviseFake({ runs: [[{ type: "reply", text: "x".repeat(10_000) }]] });
  const healthy = superviseFake({});
  try {
    await bad.supervisor.launch({ ...bad.fake.spec(), maxRpcFrameBytes: 1024 }, prompt("start"));
    await bad.waitStatus("crashed");
    assert.equal(bad.recorded.crashes[0]?.reason, "protocol_overflow");
    assert.equal(bad.recorded.crashes[0]?.fatal, true);
    assert.match(bad.recorded.crashes[0]?.message ?? "", /maxRpcFrameBytes/);
    assert.equal(bad.fake.log().filter((entry) => entry.fake === "spawn").length, 1);
    assert.deepEqual(await healthy.supervisor.launch(healthy.fake.spec(), prompt("start")), { accepted: true });
    await healthy.waitStatus("idle");
  } finally {
    await bad.cleanup();
    await healthy.cleanup();
  }
});

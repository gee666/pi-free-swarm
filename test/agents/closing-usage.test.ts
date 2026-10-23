import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import type { UsageSample } from "../../src/runtime-types.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

test("current closing-life usage remains attributable until exit while delivery and activity stay fenced", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const usage: UsageSample[] = [];
  const reads: number[][] = [];
  const activity: unknown[] = [];
  const supervisor = new AgentSupervisor({
    name: "Maria",
    watchdog: RELAXED_WATCHDOG,
    transportFactory: fake.factory,
    hooks: {
      onStatus: () => {},
      onUsage: (sample) => usage.push(sample),
      onMessagesRead: (ids) => reads.push(ids),
      onActivity: (value) => activity.push(value),
      onCrash: (crash) => assert.fail(crash.message),
    },
  });
  try {
    const launch = supervisor.launch(fixture.spec(), null);
    const transport = fake.instances[0];
    assert.ok(transport);
    transport.respond();
    assert.deepEqual(await launch, { accepted: true });
    const delivery = supervisor.deliver({ text: "[swarm message #42] queued work", messageIds: [42] });
    await Promise.resolve();
    transport.respond();
    assert.deepEqual(await delivery, { accepted: true });
    transport.event({ type: "agent_start" });
    const closing = supervisor.stop();
    const message = {
      type: "message_end",
      message: {
        role: "assistant",
        model: "alpha",
        content: [],
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } },
      },
    };
    transport.event(message);
    transport.event({ type: "tool_execution_start", toolName: "must-not-advance" });
    transport.event({ type: "message_start", message: { role: "user", content: "[swarm message #42] queued work" } });
    assert.deepEqual(
      usage.map((sample) => sample.cost),
      [0.5],
    );
    assert.deepEqual(reads, []);
    assert.deepEqual(activity, []);
    await closing;
    transport.event(message);
    assert.equal(usage.length, 1, "retired process events after exit cannot add usage");
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor, type SupervisorHooks } from "../../src/agents/supervisor.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("delivery authorization and queued sends cannot cross process generations", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const reads: number[][] = [];
  const hooks: SupervisorHooks = {
    onStatus: () => undefined,
    onUsage: () => undefined,
    onActivity: () => undefined,
    onCrash: () => undefined,
    onMessagesRead: (ids) => reads.push(ids),
  };
  const supervisor = new AgentSupervisor({
    name: "Maria",
    hooks,
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
  });
  try {
    const launching = supervisor.launch(fixture.spec(), { text: "[swarm message #1] first", messageIds: [1] });
    const first = fake.instances[0];
    assert.ok(first);
    first.respond();
    await flush();
    // Entering context before the prompt acknowledgment is valid proof.
    first.event({ type: "message_start", message: { role: "user", content: "[swarm message #1] first" } });
    assert.deepEqual(reads, [[1]]);
    first.respond();
    await launching;
    first.event({ type: "agent_start" });
    const inFlight = supervisor.deliver({ text: "[swarm message #2] pending", messageIds: [2] });
    const queued = supervisor.deliver({ text: "[swarm message #3] queued", messageIds: [3] });
    await flush();
    first.exit();
    const replacement = supervisor.launch(fixture.spec(), null);
    const second = fake.instances[1];
    assert.ok(second);
    second.respond();
    await replacement;
    await inFlight;
    assert.equal((await queued).accepted, false);
    first.event({ type: "message_start", message: { role: "user", content: "[swarm message #2] pending" } });
    second.event({ type: "message_start", message: { role: "user", content: "[swarm message #1] first" } });
    assert.deepEqual(reads, [[1]]);
    assert.deepEqual(
      second.commands.map((command) => command.type),
      ["set_steering_mode"],
    );
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

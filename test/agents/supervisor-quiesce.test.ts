import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("graceful quiescence clears accepted steering and rejects new work without interrupting the active turn", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const reads: number[][] = [];
  const supervisor = new AgentSupervisor({
    name: "Maria",
    watchdog: RELAXED_WATCHDOG,
    transportFactory: fake.factory,
    hooks: {
      onStatus: () => undefined,
      onUsage: () => undefined,
      onActivity: () => undefined,
      onCrash: () => undefined,
      onMessagesRead: (ids) => reads.push(ids),
    },
  });
  try {
    const launching = supervisor.launch(fixture.spec(), { text: "work", messageIds: [] });
    const transport = fake.instances[0];
    assert.ok(transport);
    transport.respond();
    await flush();
    transport.respond();
    await launching;
    transport.event({ type: "agent_start" });
    const delivered = supervisor.deliver({ text: "[swarm message #8] later", messageIds: [8] });
    await flush();
    transport.respond();
    assert.deepEqual(await delivered, { accepted: true });
    const draining = supervisor.quiesce();
    assert.equal(transport.commands.at(-1)?.type, "clear_queue");
    transport.respond();
    await draining;
    assert.equal(supervisor.status, "working");
    assert.equal(transport.stopped, false);
    assert.deepEqual(reads, []);
    assert.equal((await supervisor.deliver({ text: "new work", messageIds: [] })).accepted, false);
    transport.event({ type: "agent_settled" });
    assert.equal(supervisor.status, "idle");
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

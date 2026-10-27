import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

test("a previous turn settling after queue acknowledgment cannot discard the newer payload's observation proof", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const reads: number[][] = [];
  const supervisor = new AgentSupervisor({
    name: "Maria",
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
    hooks: {
      onStatus: () => {},
      onUsage: () => {},
      onActivity: () => {},
      onCrash: (crash) => assert.fail(crash.message),
      onMessagesRead: (ids) => reads.push(ids),
    },
  });
  try {
    const launch = supervisor.launch(fixture.spec(), null);
    const transport = fake.instances[0];
    assert.ok(transport);
    transport.respond();
    await launch;
    const initial = supervisor.deliver({ text: "previous turn", messageIds: [] });
    await Promise.resolve();
    transport.respond();
    assert.deepEqual(await initial, { accepted: true });
    transport.event({ type: "agent_start" });
    const text = "[swarm message #41] next\n[swarm post #7] Evidence\nComplete fresh body.";
    const queued = supervisor.deliver({ text, messageIds: [41] });
    await Promise.resolve();
    transport.respond();
    assert.deepEqual(await queued, { accepted: true });
    assert.deepEqual(reads, [], "queue acceptance is not observation");
    transport.event({ type: "agent_settled" });
    transport.event({ type: "agent_start" });
    transport.event({ type: "message_start", message: { role: "user", content: text } });
    assert.deepEqual(reads, [[41]]);
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

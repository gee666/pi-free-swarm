import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor, type SupervisorHooks } from "../../src/agents/supervisor.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function recordingHooks(reads: number[][]): SupervisorHooks {
  return {
    onStatus: () => undefined,
    onUsage: () => undefined,
    onActivity: () => undefined,
    onCrash: () => undefined,
    onMessagesRead: (ids) => reads.push(ids),
  };
}

test("final payload revalidation cannot write after stopping or retiring its generation", async () => {
  for (const action of ["stop", "retire"] as const) {
    const fixture = createFakePiRun({});
    const fake = fakeTransportFactory();
    const reads: number[][] = [];
    const supervisor = new AgentSupervisor({
      name: "Maria",
      hooks: recordingHooks(reads),
      transportFactory: fake.factory,
      watchdog: RELAXED_WATCHDOG,
    });
    try {
      const launching = supervisor.launch(fixture.spec(), null);
      const process = fake.instances[0];
      assert.ok(process);
      process.respond();
      assert.equal((await launching).accepted, true);
      const result = await supervisor.deliver({
        text: "[swarm message #4] withdrawn",
        messageIds: [4],
        beforeSend: () => {
          if (action === "stop") void supervisor.stop();
          else process.exit();
          return { text: "[swarm message #4] withdrawn", messageIds: [4] };
        },
      });
      assert.equal(result.accepted, false);
      assert.deepEqual(
        process.commands.map((command) => command.type),
        ["set_steering_mode"],
      );
      process.event({ type: "message_start", message: { role: "user", content: "[swarm message #4] withdrawn" } });
      assert.deepEqual(reads, []);
      await supervisor.stop();
      if (action === "stop") assert.equal(process.stopped, true);
    } finally {
      await supervisor.stop();
      fixture.cleanup();
    }
  }
});

test("a withdrawn startup payload boots idle without a prompt, crash or read authorization", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const reads: number[][] = [];
  let crashes = 0;
  const supervisor = new AgentSupervisor({
    name: "Watcher",
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
    hooks: {
      ...recordingHooks(reads),
      onCrash: () => {
        crashes++;
      },
    },
  });
  try {
    const launching = supervisor.launch(fixture.spec("Watcher"), {
      text: "[swarm message #5] withdrawn startup",
      messageIds: [5],
      beforeSend: () => null,
    });
    const process = fake.instances[0];
    assert.ok(process);
    process.respond();
    const outcome = await launching;
    assert.equal(outcome.accepted, false);
    if (!outcome.accepted) assert.equal(outcome.withdrawn, true);
    assert.equal(supervisor.status, "idle");
    assert.equal(crashes, 0);
    assert.deepEqual(
      process.commands.map((command) => command.type),
      ["set_steering_mode"],
    );
    process.event({
      type: "message_start",
      message: { role: "user", content: "[swarm message #5] withdrawn startup" },
    });
    assert.deepEqual(reads, []);
    const next = supervisor.deliver({ text: "[swarm message #6] later question", messageIds: [6] });
    await flush();
    process.respond();
    assert.equal((await next).accepted, true);
    assert.equal(crashes, 0);
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

test("quiescing during startup settles launch and joins cleanup without another command", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const supervisor = new AgentSupervisor({
    name: "Maria",
    hooks: recordingHooks([]),
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
  });
  try {
    const launching = supervisor.launch(fixture.spec(), { text: "go", messageIds: [] });
    const process = fake.instances[0];
    assert.ok(process);
    await supervisor.quiesce();
    assert.equal((await launching).accepted, false);
    assert.equal(supervisor.status, "stopped");
    assert.equal(process.stopped, true);
    assert.deepEqual(
      process.commands.map((command) => command.type),
      ["set_steering_mode"],
    );
    assert.equal(process.pending.length, 0);
  } finally {
    await supervisor.stop();
    fixture.cleanup();
  }
});

test("delivery authorization and queued sends cannot cross process generations", async () => {
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const reads: number[][] = [];
  const hooks = recordingHooks(reads);
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

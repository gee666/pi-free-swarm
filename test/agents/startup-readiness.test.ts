import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor, type AgentCrash } from "../../src/agents/supervisor.js";
import { createFakePiRun, waitFor } from "../fixtures/fake-pi/harness.js";
import { fakeTransportFactory } from "./fake-transport.js";
import { RELAXED_WATCHDOG } from "./supervisor-helpers.js";

function setup() {
  const fake = fakeTransportFactory();
  const fixture = createFakePiRun({});
  const crashes: AgentCrash[] = [];
  let ready = 0;
  const supervisor = new AgentSupervisor({
    name: "fixture",
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
    hooks: {
      onReady: () => ready++,
      onStatus: () => undefined,
      onMessagesRead: () => undefined,
      onUsage: () => undefined,
      onActivity: () => undefined,
      onCrash: (crash) => crashes.push(crash),
    },
  });
  return { fake, fixture, supervisor, crashes, ready: () => ready };
}

test("spawn and prompt acceptance are not readiness; first agent_start is", async () => {
  const run = setup();
  try {
    const launching = run.supervisor.launch(run.fixture.spec(), { text: "start", messageIds: [] });
    const transport = run.fake.instances[0];
    assert.ok(transport);
    assert.equal(run.ready(), 0);
    transport.respond();
    await waitFor(() => transport.commands.length === 2, "prompt sent");
    transport.respond();
    await launching;
    assert.equal(run.ready(), 0);
    transport.event({ type: "agent_start" });
    transport.event({ type: "agent_start" });
    assert.equal(run.ready(), 1);
  } finally {
    await run.supervisor.stop();
    run.fixture.cleanup();
  }
});

test("only structured OS resource codes classify shared recovery, never stderr guesses", async () => {
  for (const code of ["EMFILE", "EAGAIN", "ENFILE", "ENOENT", undefined]) {
    const run = setup();
    try {
      const launching = run.supervisor.launch(run.fixture.spec(), { text: "start", messageIds: [] });
      run.fake.instances[0]?.exit({
        spawnError: "fixture error",
        spawnErrorCode: code,
        stderrTail: "EMFILE unavailable overload",
      });
      await launching;
      assert.equal(run.crashes[0]?.sharedFailure, code && code !== "ENOENT" ? "spawn-resource" : undefined);
      assert.equal(run.crashes[0]?.fatal, code === "ENOENT");
      assert.equal(run.crashes[0]?.sharedStartupFailure, code === "ENOENT" ? "launch-command" : undefined);
    } finally {
      await run.supervisor.stop();
      run.fixture.cleanup();
    }
  }
});

test("ENOENT-looking text without a structured code does not establish shared fatal failure", async () => {
  const run = setup();
  try {
    const launching = run.supervisor.launch(run.fixture.spec(), { text: "start", messageIds: [] });
    run.fake.instances[0]?.exit({ spawnError: "ENOENT", stderrTail: "ENOENT: unavailable command" });
    await launching;
    assert.equal(run.crashes[0]?.fatal, false);
    assert.equal(run.crashes[0]?.sharedStartupFailure, undefined);
  } finally {
    await run.supervisor.stop();
    run.fixture.cleanup();
  }
});

test("rejected steering configuration is fatal before any prompt or ready signal", async () => {
  const run = setup();
  try {
    const launching = run.supervisor.launch(run.fixture.spec(), { text: "start", messageIds: [] });
    run.fake.instances[0]?.respond({ type: "response", success: false, error: "unsupported mode" });
    assert.equal((await launching).accepted, false);
    assert.equal(run.ready(), 0);
    assert.equal(run.crashes[0]?.fatal, true);
    assert.equal(run.fake.instances[0]?.commands.length, 1);
  } finally {
    await run.supervisor.stop();
    run.fixture.cleanup();
  }
});

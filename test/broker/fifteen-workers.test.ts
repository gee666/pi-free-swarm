import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { sendMessage } from "../../src/broker/messages.js";
import { prepareRunCompletion } from "../../src/broker/run-acceptance.js";
import { listOpenAgentRecipients } from "../../src/store/message-queries.js";
import { SCENARIOS, createFakePiRun, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

// Real local children exercise the RPC adapter. No model/provider requests are made.
test("15 real fixture workers start and 11 matching votes finish despite dissent and pending messages", async () => {
  useFakePi();
  const temp = createTempDb();
  const names = Array.from({ length: 15 }, (_, index) => `Worker${index + 1}`);
  const swarm = seedSwarm(temp.db, { agents: names });
  const workers = names.map((name) => {
    const fake = createFakePiRun(SCENARIOS.settle);
    const reads: number[] = [];
    const crashes: string[] = [];
    const supervisor = new AgentSupervisor({
      name,
      watchdog: { startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, startupRetries: 0 },
      hooks: {
        onStatus: (status) => setAgentStatus(temp.db, swarm.id, name, status, T0),
        onMessagesRead: (ids) => reads.push(...ids),
        onUsage: () => {},
        onActivity: () => {},
        onCrash: (crash) => crashes.push(crash.message),
      },
    });
    return { name, fake, supervisor, reads, crashes };
  });
  try {
    const launches = await Promise.all(
      workers.map(({ fake, name, supervisor }, index) =>
        supervisor.launch(fake.spec(name), {
          text: `Begin.\n[swarm message #${index + 1}] assigned work`,
          messageIds: [index + 1],
        }),
      ),
    );
    assert.deepEqual(
      launches,
      names.map(() => ({ accepted: true })),
    );
    await waitFor(() => workers.every(({ supervisor }) => supervisor.status === "idle"), "15 workers idle", 10_000);
    for (const [index, worker] of workers.entries()) {
      assert.deepEqual(worker.reads, [index + 1]);
      assert.deepEqual(worker.crashes, []);
      const mode = worker.fake.log().find((command) => command.type === "set_steering_mode");
      assert.equal(mode?.mode, "all");
    }
    const input = { swarmId: swarm.id, run: 1, runnerPid: process.pid, now: T0 };
    const vote = (name: string, verdict: "accepted" | "blocked") =>
      mutateAcceptance(temp.db, swarm.id, name, { action: "vote", verdict, reason: "fixture evidence" }, T0);
    for (const name of names.slice(0, 10)) vote(name, "accepted");
    for (const name of names.slice(11)) vote(name, "blocked");
    assert.equal(inspectAcceptance(temp.db, swarm.id).threshold, 11);
    assert.deepEqual(prepareRunCompletion(temp.db, input), { kind: "pending" });
    const pending = sendMessage(temp.db, swarm.id, "User", [names[14]], "Keep this pending at quorum", T0);
    vote(names[10], "accepted");
    const completion = prepareRunCompletion(temp.db, input);
    assert.equal(completion.kind, "closed");
    if (completion.kind !== "closed") throw new Error("Expected 11/15 quorum closure");
    assert.equal(completion.acceptance.verdict, "accepted");
    assert.equal(completion.acceptance.votes.length, 15);
    assert.deepEqual(listOpenAgentRecipients(temp.db, swarm.id), [
      { messageId: pending.id, name: names[14], status: "pending" },
    ]);
  } finally {
    await Promise.all(workers.map(({ supervisor }) => supervisor.stop()));
    for (const worker of workers) {
      assert.equal(worker.supervisor.status, "stopped");
      worker.fake.cleanup();
    }
    temp.cleanup();
  }
});

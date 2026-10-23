import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { sweepStaleRuns } from "../../src/broker/swarms.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  BOARD_URL,
  createRunFixture,
  isAlive,
  newestSwarmId,
  recipientStatus,
  spawnsOf,
  systemReplies,
  waitFor,
  waitForWorkersIdle,
  voteAll,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

describe("the end of a run", () => {
  it("launches every worker on its stagger while earlier workers remain working", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.inactivityStall, { staggerSeconds: 0.1 });
    fixture = run;
    const controller = new AbortController();
    const outcome = startSwarm(
      run.env,
      { name: "stagger", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 5 },
      { signal: controller.signal },
    );
    try {
      const swarmId = newestSwarmId(run.db);
      const names = agentNames(run.db, swarmId);
      await waitFor(
        () => names.every((name) => agentStatus(run.db, swarmId, name) === "working"),
        "every worker working",
        10_000,
      );
      assert.equal(spawnsOf(run.fake).length, names.length);
      assert.equal(getSwarm(run.db, swarmId, Date.now())?.status, "running");
    } finally {
      controller.abort();
      assert.equal((await outcome).end, "stopped");
    }
  });

  it("keeps quiet workers available for late messages until an explicit quorum", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(
      run.env,
      { name: "grace", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
      { onProgress: (progress) => run.progress.push(progress) },
    );
    const swarmId = newestSwarmId(db);
    const [name] = agentNames(db, swarmId);
    await waitFor(() => agentStatus(db, swarmId, name) === "idle", "agent idle");
    const snapshots = run.progress.length;
    await waitFor(() => run.progress.length >= snapshots + 3, "progress while idle without votes");
    assert.equal(getSwarm(db, swarmId, Date.now())?.status, "running");
    const late = sendMessage(db, swarmId, "User", [name], "one more thing", Date.now()).id;
    await waitFor(() => recipientStatus(db, late, name) === "read", "late message read");
    await waitForWorkersIdle(run, swarmId);
    voteAll(db, swarmId, "accepted", "Late request was handled and the goal checked.");

    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(recipientStatus(db, late, name), "read");

    const [firstSnapshot] = run.progress;
    assert.equal(firstSnapshot.swarmId, swarmId);
    assert.equal(firstSnapshot.boardUrl, BOARD_URL);
    assert.equal(firstSnapshot.agents.pending + firstSnapshot.agents.starting, 1);
    const last = run.progress.at(-1);
    assert.equal(last?.status, "finished");
    assert.equal(last?.agents.stopped, 1);
    assert.equal(last?.messages, 1, "only the late request, no automatic acceptance notice");
    assert.ok((last?.cost ?? 0) > 0 && (last?.tokens ?? 0) > 0);
  });

  it(
    "quorum stops an active tool and preserves unread steering without waiting for quiet",
    { timeout: 10_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.longTool(60_000));
      fixture = run;
      const outcome = startSwarm(
        run.env,
        { name: "active quorum", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
        {},
      );
      const swarmId = newestSwarmId(run.db);
      const [name] = agentNames(run.db, swarmId);
      await waitFor(() => agentStatus(run.db, swarmId, name) === "working", "worker running tool");
      const steering = sendMessage(run.db, swarmId, "User", [name], "still queued in pi", Date.now());
      await waitFor(() => recipientStatus(run.db, steering.id, name) === "delivered", "unread steering queued");
      assert.equal(agentStatus(run.db, swarmId, name), "working");

      voteAll(run.db, swarmId, "accepted", "Goal checked; the remaining tool is unnecessary.");
      const result = await outcome;
      assert.equal(result.end, "finished");
      assert.equal(result.acceptance.verdict, "accepted");
      assert.equal(agentStatus(run.db, swarmId, name), "stopped");
      assert.equal(recipientStatus(run.db, steering.id, name), "delivered");
      assert.deepEqual(systemReplies(run.db, steering.threadId), []);
      assert.ok(spawnsOf(run.fake).every((child) => !isAlive(child.pid)));
    },
  );

  it(
    "abort stops every agent's process group while retaining previously pending messages",
    { timeout: 20_000 },
    async () => {
      const run = createRunFixture({ startup: [{ type: "grandchild" }] }, { staggerSeconds: 60 });
      fixture = run;
      const { db } = run;
      const controller = new AbortController();
      const outcome = startSwarm(
        run.env,
        { name: "abort", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 2 },
        { signal: controller.signal },
      );
      const swarmId = newestSwarmId(db);
      const [first, second] = agentNames(db, swarmId);
      await waitFor(() => agentStatus(db, swarmId, first) === "idle", "first agent idle");
      const pending = sendMessage(db, swarmId, "User", [second], "waiting for my slot", Date.now());

      controller.abort();
      // The race: this lands while the agents are being stopped, before the run lock is released.
      const racing = sendMessage(db, swarmId, "User", [first], "during shutdown", Date.now());
      assert.equal(recipientStatus(db, racing.id, first), "undeliverable", "stop closes admission before shutdown");

      const result = await outcome;
      assert.equal(result.end, "stopped");
      assert.equal(getSwarm(db, swarmId, Date.now())?.status, "stopped");
      assert.deepEqual([agentStatus(db, swarmId, first), agentStatus(db, swarmId, second)], ["stopped", "stopped"]);
      assert.equal(recipientStatus(db, pending.id, second), "pending");
      assert.deepEqual(systemReplies(db, pending.threadId), []);
      assert.equal(recipientStatus(db, racing.id, first), "undeliverable");
      assert.deepEqual(systemReplies(db, racing.threadId), [UNDELIVERABLE_REPLY_TEXT]);
      const [spawn] = spawnsOf(run.fake);
      const grandchild = Number(run.fake.log().find((record) => record.fake === "grandchild")?.pid);
      assert.equal(spawnsOf(run.fake).length, 1, "the second agent never started");
      await waitFor(() => !isAlive(spawn.pid) && !isAlive(grandchild), "the whole group is gone");
    },
  );

  it("stopAllRuns stops a run for session_shutdown", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const outcome = startSwarm(
      run.env,
      { name: "shutdown", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
      {},
    );
    const swarmId = newestSwarmId(run.db);
    await waitFor(() => agentStatus(run.db, swarmId, agentNames(run.db, swarmId)[0]) === "idle", "agent idle");
    await stopAllRuns();
    assert.equal((await outcome).end, "stopped");
  });

  it("ends as interrupted without writing when a sweep took the lock", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(
      run.env,
      { name: "lost", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
      {},
    );
    const swarmId = newestSwarmId(db);
    const [name] = agentNames(db, swarmId);
    await waitFor(() => agentStatus(db, swarmId, name) === "idle", "agent idle");
    // Another process decided this runner is dead.
    assert.deepEqual(
      sweepStaleRuns(db, Date.now(), () => false),
      [swarmId],
    );
    const result = await outcome;
    assert.equal(result.end, "interrupted");
    assert.equal(result.swarm.status, "interrupted");
    assert.equal(agentStatus(db, swarmId, name), "stopped");
  });
});

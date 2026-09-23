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
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());

describe("the end of a run", () => {
  it("finishes only after a full grace of quiet, restarted by a late message", { timeout: 20_000 }, async () => {
    const graceMs = 800;
    const run = createRunFixture(SCENARIOS.settle, { timings: { completionGraceMs: graceMs } });
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(
      run.env,
      { name: "grace", taskPrompt: "Work.", agentAmount: 1 },
      { onProgress: (progress) => run.progress.push(progress) },
    );
    const swarmId = newestSwarmId(db);
    const [name] = agentNames(db, swarmId);
    await waitFor(() => agentStatus(db, swarmId, name) === "idle", "agent idle");
    await new Promise((resolve) => setTimeout(resolve, graceMs / 2));
    const lateAt = Date.now();
    const late = sendMessage(db, swarmId, "User", [name], "one more thing", lateAt).id;

    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(recipientStatus(db, late, name), "read");
    const finishedAt = result.swarm.finishedAt ?? 0;
    assert.ok(finishedAt - lateAt >= graceMs, `finished ${finishedAt - lateAt} ms after the late message`);

    const [firstSnapshot] = run.progress;
    assert.equal(firstSnapshot.swarmId, swarmId);
    assert.equal(firstSnapshot.boardUrl, BOARD_URL);
    assert.equal(firstSnapshot.agents.pending + firstSnapshot.agents.starting, 1);
    const last = run.progress.at(-1);
    assert.equal(last?.status, "finished");
    assert.equal(last?.agents.idle, 1);
    assert.equal(last?.messages, 1);
    assert.ok((last?.cost ?? 0) > 0 && (last?.tokens ?? 0) > 0);
  });

  it("abort stops every agent's process group and makes open messages undeliverable", { timeout: 20_000 }, async () => {
    const run = createRunFixture({ startup: [{ type: "grandchild" }] }, { staggerSeconds: 60 });
    fixture = run;
    const { db } = run;
    const controller = new AbortController();
    const outcome = startSwarm(
      run.env,
      { name: "abort", taskPrompt: "Work.", agentAmount: 2 },
      { signal: controller.signal },
    );
    const swarmId = newestSwarmId(db);
    const [first, second] = agentNames(db, swarmId);
    await waitFor(() => agentStatus(db, swarmId, first) === "idle", "first agent idle");
    const pending = sendMessage(db, swarmId, "User", [second], "waiting for my slot", Date.now());

    controller.abort();
    // The race: this lands while the agents are being stopped, before the run lock is released.
    const racing = sendMessage(db, swarmId, "User", [first], "during shutdown", Date.now());
    assert.equal(recipientStatus(db, racing.id, first), "pending");

    const result = await outcome;
    assert.equal(result.end, "stopped");
    assert.equal(getSwarm(db, swarmId, Date.now())?.status, "stopped");
    assert.deepEqual([agentStatus(db, swarmId, first), agentStatus(db, swarmId, second)], ["stopped", "stopped"]);
    for (const message of [pending, racing]) {
      assert.equal(recipientStatus(db, message.id, message.recipients[0].name), "undeliverable");
      assert.deepEqual(systemReplies(db, message.threadId), [UNDELIVERABLE_REPLY_TEXT]);
    }
    const [spawn] = spawnsOf(run.fake);
    const grandchild = Number(run.fake.log().find((record) => record.fake === "grandchild")?.pid);
    assert.equal(spawnsOf(run.fake).length, 1, "the second agent never started");
    await waitFor(() => !isAlive(spawn.pid) && !isAlive(grandchild), "the whole group is gone");
  });

  it("stopAllRuns stops a run for session_shutdown", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const outcome = startSwarm(run.env, { name: "shutdown", taskPrompt: "Work.", agentAmount: 1 }, {});
    const swarmId = newestSwarmId(run.db);
    await waitFor(() => agentStatus(run.db, swarmId, agentNames(run.db, swarmId)[0]) === "idle", "agent idle");
    await stopAllRuns();
    assert.equal((await outcome).end, "stopped");
  });

  it("ends as interrupted without writing when a sweep took the lock", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle, { timings: { completionGraceMs: 60_000 } });
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(run.env, { name: "lost", taskPrompt: "Work.", agentAmount: 1 }, {});
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

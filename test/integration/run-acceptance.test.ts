import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { sendMessage } from "../../src/broker/messages.js";
import { resumeSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  recipientStatus,
  voteAll,
  waitFor,
  waitForWorkersIdle,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

async function observePending(run: RunFixture, id: number): Promise<void> {
  const snapshots = run.progress.length;
  await waitFor(() => run.progress.length >= snapshots + 3, "continued run progress without quorum");
  assert.equal(getSwarm(run.db, id, Date.now())?.status, "running");
}

it("quiescence stays unchecked without manufacturing votes or a checkpoint", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  let settled = false;
  const outcome = startSwarm(
    run.env,
    { name: "no volunteer", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 2 },
    { onProgress: (progress) => run.progress.push(progress) },
  ).then((result) => {
    settled = true;
    return result;
  });
  const id = newestSwarmId(run.db);
  await waitForWorkersIdle(run, id);
  await observePending(run, id);
  assert.equal(settled, false);
  const acceptance = inspectAcceptance(run.db, id);
  assert.equal(acceptance.verdict, "unchecked");
  assert.deepEqual(acceptance.votes, []);
  assert.equal(acceptance.threshold, 2);
  assert.deepEqual(acceptance.acceptanceCriteria, ["Work is complete."]);
  assert.equal(promptTexts(run.fake).length, 2, "only worker kickoffs");

  voteAll(run.db, id, "accepted", "Both workers checked the required output.");
  assert.equal((await outcome).end, "finished");
});

for (const verdict of ["accepted", "blocked"] as const) {
  it(`an explicit ${verdict} quorum finishes with the voter's reason`, { timeout: 10_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const outcome = startSwarm(
      run.env,
      { name: verdict, taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
      {},
    );
    const id = newestSwarmId(run.db);
    await waitForWorkersIdle(run, id);
    voteAll(run.db, id, verdict, "Checked the output against the goal.");
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.acceptance.verdict, verdict);
    assert.equal(result.acceptance.counts[verdict], 1);
    assert.equal(result.acceptance.threshold, 1);
    assert.equal(result.acceptance.votes[0]?.reason, "Checked the output against the goal.");
    assert.equal(promptTexts(run.fake).length, 1, "voting does not wake a checker");
  });
}

it("incomplete votes keep the run open until the agent changes its vote", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "unfinished", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
    { onProgress: (progress) => run.progress.push(progress) },
  );
  const id = newestSwarmId(run.db);
  await waitForWorkersIdle(run, id);
  voteAll(run.db, id, "incomplete", "Required output is missing.");
  await observePending(run, id);
  assert.equal(inspectAcceptance(run.db, id).verdict, "incomplete");
  voteAll(run.db, id, "accepted", "Required output now exists and passes checks.");
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.deepEqual(result.acceptance.counts, { accepted: 1, incomplete: 0, blocked: 0 });
  assert.equal(result.acceptance.votes.length, 1, "the new vote replaces the old vote");
});

it("mixed votes need a 70 percent quorum of all workers", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "split", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 4 },
    { onProgress: (progress) => run.progress.push(progress) },
  );
  const id = newestSwarmId(run.db);
  await waitForWorkersIdle(run, id);
  const names = agentNames(run.db, id);
  for (const [index, agent] of names.entries()) {
    const verdict = index < 2 ? "accepted" : index === 2 ? "blocked" : "incomplete";
    mutateAcceptance(
      run.db,
      id,
      agent,
      { action: "vote", verdict, reason: `Worker ${index} inspected the goal.` },
      Date.now(),
    );
  }
  await observePending(run, id);
  const split = inspectAcceptance(run.db, id);
  assert.equal(split.totalAgents, 4, "Watcher is not a voter");
  assert.equal(split.threshold, 3);
  assert.deepEqual(split.counts, { accepted: 2, incomplete: 1, blocked: 1 });
  assert.equal(split.verdict, "incomplete");
  mutateAcceptance(
    run.db,
    id,
    names[3],
    { action: "vote", verdict: "accepted", reason: "Missing check now passes." },
    Date.now(),
  );
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.equal(result.acceptance.verdict, "accepted");
  assert.deepEqual(result.acceptance.counts, { accepted: 3, incomplete: 0, blocked: 1 });
});

it("a voter crash removes its vote without inventing a blocked consensus", { timeout: 10_000 }, async () => {
  const run = createRunFixture(
    {
      runs: [
        [
          { type: "tool", ms: 1000 },
          { type: "exit", code: 3, stderr: "voter failed" },
        ],
      ],
    },
    { timings: { reviveBackoffMs: [] } },
  );
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "failed voter", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 2 },
    { onProgress: (progress) => run.progress.push(progress) },
  );
  const id = newestSwarmId(run.db);
  const [agent] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, agent) === "working", "voter working");
  mutateAcceptance(
    run.db,
    id,
    agent,
    { action: "vote", verdict: "accepted", reason: "Output checked before crash." },
    Date.now(),
  );
  await waitFor(
    () => agentNames(run.db, id).every((name) => agentStatus(run.db, id, name) === "crashed"),
    "voters crashed",
  );
  await observePending(run, id);
  assert.deepEqual(inspectAcceptance(run.db, id).votes, []);
  await stopAllRuns();
  const result = await outcome;
  assert.equal(result.end, "stopped");
  assert.equal(result.acceptance.verdict, "unchecked");
});

it("resume clears old votes and requires a fresh quorum", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  const first = startSwarm(
    run.env,
    { name: "resumed", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
    {},
  );
  const id = newestSwarmId(run.db);
  await waitForWorkersIdle(run, id);
  voteAll(run.db, id, "accepted", "Original output checked.");
  assert.equal((await first).acceptance.verdict, "accepted");
  const second = resumeSwarm(
    run.env,
    { swarmId: id, message: "Recheck against changed inputs." },
    { onProgress: (progress) => run.progress.push(progress) },
  );
  assert.equal(inspectAcceptance(run.db, id).verdict, "unchecked");
  assert.deepEqual(inspectAcceptance(run.db, id).votes, []);
  await waitForWorkersIdle(run, id);
  await observePending(run, id);
  voteAll(run.db, id, "blocked", "Changed inputs require unavailable credentials.");
  const result = await second;
  assert.equal(result.run, 2);
  assert.equal(result.acceptance.verdict, "blocked");
  assert.ok(result.acceptance.votes.every((vote) => vote.run === 2));
  assert.deepEqual(result.acceptance.acceptanceCriteria, ["Work is complete."]);
});

it("quorum closure seals votes and makes racing messages undeliverable", { timeout: 15_000 }, async () => {
  const run = createRunFixture({ ignoreSigterm: true });
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "close race", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
    {},
  );
  const id = newestSwarmId(run.db);
  const [agent] = agentNames(run.db, id);
  await waitForWorkersIdle(run, id);
  voteAll(run.db, id, "accepted", "All criteria verified.");
  await waitFor(
    () => run.db.sql.prepare("SELECT closed_run FROM acceptance WHERE swarm_id = ?").get(id)?.closed_run === 1,
    "admission sealed before child exit",
  );
  assert.equal(getSwarm(run.db, id, Date.now())?.acceptsMessages, false);
  const other = openSwarmDb(run.db.path, { create: false });
  try {
    assert.throws(
      () =>
        mutateAcceptance(
          other,
          id,
          agent,
          { action: "vote", verdict: "incomplete", reason: "New input needs rechecking." },
          Date.now(),
        ),
      /closed/,
    );
    const message = sendMessage(other, id, "User", [agent], "arrived after close", Date.now());
    assert.equal(recipientStatus(other, message.id, agent), "undeliverable");
  } finally {
    other.close();
  }
  const result = await outcome;
  assert.equal(result.acceptance.verdict, "accepted");
  assert.equal(result.acceptance.revision, 1);
  assert.equal(result.end, "finished");
});

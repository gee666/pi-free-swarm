import assert from "node:assert/strict";
import { after, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { closeRunAdmission, prepareRunCompletion } from "../../src/broker/run-acceptance.js";
import { sendMessage } from "../../src/broker/messages.js";
import { beginResume, sweepStaleRuns } from "../../src/broker/swarms.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
function setup() {
  const swarm = seedSwarm(db);
  return { swarmId: swarm.id, run: 1, runnerPid: process.pid, now: T0 };
}

function vote(swarmId: number, agent: string, verdict: "accepted" | "incomplete" | "blocked") {
  return mutateAcceptance(db, swarmId, agent, { action: "vote", verdict, reason: `${agent}: ${verdict}` }, T0);
}

it("idle agents without a quorum never close the run", () => {
  const input = setup();
  db.sql.prepare("UPDATE participants SET status = 'idle' WHERE swarm_id = ? AND kind = 'agent'").run(input.swarmId);
  assert.deepEqual(prepareRunCompletion(db, input), { kind: "pending" });
  vote(input.swarmId, "Maria", "accepted");
  vote(input.swarmId, "John", "accepted");
  vote(input.swarmId, "Liam", "blocked");
  assert.deepEqual(prepareRunCompletion(db, input), { kind: "pending" });
});

it("closure rechecks current votes under the write lock rather than using a stale quorum", () => {
  const input = setup();
  for (const name of ["Maria", "John", "Liam"]) vote(input.swarmId, name, "accepted");
  const stale = inspectAcceptance(db, input.swarmId);
  assert.equal(stale.verdict, "accepted");
  const other = openSwarmDb(db.path, { create: false });
  try {
    mutateAcceptance(
      other,
      input.swarmId,
      "John",
      {
        action: "vote",
        verdict: "incomplete",
        reason: "Output changed; rerun the checks.",
      },
      T0,
    );
  } finally {
    other.close();
  }
  assert.deepEqual(prepareRunCompletion(db, input), { kind: "pending" });
  vote(input.swarmId, "John", "accepted");
  const result = prepareRunCompletion(db, input);
  assert.equal(result.kind, "closed");
  if (result.kind !== "closed") throw new Error("Expected closure");
  assert.equal(result.acceptance.verdict, "accepted");
  assert.equal(result.acceptance.votes.length, 3);
  assert.throws(() => vote(input.swarmId, "John", "incomplete"), /closed|not running/i);
});

for (const verdict of ["accepted", "blocked"] as const) {
  it(`${verdict} quorum closes even with active agents and pending messages`, () => {
    const input = setup();
    sendMessage(db, input.swarmId, "User", ["Maria"], "message before close", T0);
    db.sql
      .prepare("UPDATE participants SET status = 'working' WHERE swarm_id = ? AND kind = 'agent'")
      .run(input.swarmId);
    for (const name of ["Maria", "John", "Liam"]) vote(input.swarmId, name, verdict);
    const result = prepareRunCompletion(db, input);
    assert.equal(result.kind, "closed");
    if (result.kind !== "closed") throw new Error("Expected closure");
    assert.equal(result.acceptance.verdict, verdict);
  });
}

it("stale runners cannot seal and cancellation freezes votes without a false verdict", () => {
  const input = setup();
  vote(input.swarmId, "Maria", "accepted");
  assert.deepEqual(prepareRunCompletion(db, { ...input, run: 2 }), { kind: "lost" });
  assert.deepEqual(prepareRunCompletion(db, { ...input, runnerPid: process.pid + 1 }), { kind: "lost" });
  const snapshot = closeRunAdmission(db, input);
  assert.equal(snapshot?.verdict, "incomplete");
  assert.equal(snapshot?.votes.length, 1);
  assert.throws(() => vote(input.swarmId, "John", "accepted"), /closed|not running/i);
});

it("stale-run cleanup freezes votes and resume clears them", () => {
  const input = setup();
  vote(input.swarmId, "Maria", "accepted");
  sweepStaleRuns(db, T0 + 1, () => false);
  assert.equal(inspectAcceptance(db, input.swarmId).votes.length, 1);
  assert.throws(() => vote(input.swarmId, "John", "accepted"), /closed|not running/i);
  const resumed = beginResume(db, input.swarmId, process.pid, T0 + 2);
  assert.equal(resumed.run, 2);
  assert.equal(inspectAcceptance(db, input.swarmId).verdict, "unchecked");
  assert.equal(inspectAcceptance(db, input.swarmId).votes.length, 0);
  vote(input.swarmId, "John", "accepted");
  assert.equal(inspectAcceptance(db, input.swarmId).votes[0]?.run, 2);
});

import assert from "node:assert/strict";
import { after, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { prepareRunCompletion } from "../../src/broker/run-acceptance.js";
import { sendMessage } from "../../src/broker/messages.js";
import { beginResume, sweepStaleRuns } from "../../src/broker/swarms.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
function quiet() {
  const swarm = seedSwarm(db);
  db.sql.prepare("UPDATE participants SET status = 'idle' WHERE swarm_id = ? AND kind = 'agent'").run(swarm.id);
  return {
    swarmId: swarm.id,
    run: 1,
    runnerPid: process.pid,
    now: T0,
    available: ["Maria", "John", "Liam"],
    exhausted: new Set<string>(),
  };
}

it("closure uses the current revision, not an earlier accepted snapshot", () => {
  const input = quiet();
  mutateAcceptance(db, input.swarmId, "Maria", { action: "claim", revision: 0 }, T0);
  mutateAcceptance(
    db,
    input.swarmId,
    "Maria",
    {
      action: "update",
      revision: 1,
      verdict: "accepted",
      payload: {
        evidence: [{ reference: "tests.log", result: "passed" }],
        knownGaps: [],
        findings: [],
      },
    },
    T0,
  );
  const stale = inspectAcceptance(db, input.swarmId);
  const other = openSwarmDb(db.path, { create: false });
  try {
    mutateAcceptance(
      other,
      input.swarmId,
      "John",
      { action: "challenge", revision: stale.revision, finding: "New input differs; rerun the checks." },
      T0,
    );
  } finally {
    other.close();
  }
  const result = prepareRunCompletion(db, input);
  assert.equal(result.kind, "closed");
  if (result.kind !== "closed") throw new Error("Expected closure");
  assert.equal(result.acceptance.verdict, "incomplete");
  assert.equal(result.acceptance.revision, stale.revision + 1);
});

it("new messages and DB work prevent closure even after a runtime quiet observation", () => {
  const input = quiet();
  sendMessage(db, input.swarmId, "User", ["Maria"], "new work before close", T0);
  assert.deepEqual(prepareRunCompletion(db, input), { kind: "pending" });
  assert.equal(
    db.sql.prepare("SELECT closed_run FROM acceptance WHERE swarm_id = ?").get(input.swarmId)?.closed_run,
    null,
  );
  assert.equal(
    db.sql.prepare("SELECT count(*) AS n FROM acceptance_notifications WHERE swarm_id = ?").get(input.swarmId)?.n,
    0,
  );
  const busy = quiet();
  db.sql.prepare("UPDATE participants SET status = 'working' WHERE swarm_id = ? AND name = 'Maria'").run(busy.swarmId);
  assert.deepEqual(prepareRunCompletion(db, busy), { kind: "pending" });
});

it("stale runners cannot queue or seal; interrupted claims are invalidated before resume", () => {
  const input = quiet();
  assert.deepEqual(prepareRunCompletion(db, { ...input, run: 2 }), { kind: "lost" });
  assert.deepEqual(prepareRunCompletion(db, { ...input, runnerPid: process.pid + 1 }), { kind: "lost" });
  mutateAcceptance(db, input.swarmId, "Maria", { action: "claim", revision: 0 }, T0);
  sweepStaleRuns(db, T0 + 1, () => false);
  const interrupted = inspectAcceptance(db, input.swarmId);
  assert.equal(interrupted.verdict, "incomplete");
  assert.equal(interrupted.claimant, null);
  assert.match(interrupted.findings.join("\n"), /Run interrupted/);
  const resumed = beginResume(db, input.swarmId, process.pid, T0 + 2);
  assert.equal(resumed.run, 2);
  assert.equal(inspectAcceptance(db, input.swarmId).verdict, "unchecked");
  assert.equal(inspectAcceptance(db, input.swarmId).evidence.length, 1);
  assert.throws(
    () => mutateAcceptance(db, input.swarmId, "Maria", { action: "release", revision: 1 }, T0 + 3),
    /Stale/,
  );
});

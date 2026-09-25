import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { sendMessage } from "../../src/broker/messages.js";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
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
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());
const accepted = {
  evidence: [{ reference: "checks.log", result: "Requirements inspected; checks passed" }],
  knownGaps: [],
  findings: [],
};
const incomplete = {
  evidence: [{ reference: "checks.log", result: "Missing required output" }],
  knownGaps: ["Output missing"],
  findings: ["Implement the required output"],
};
function notices(run: RunFixture, id: number): number {
  return Number(run.db.sql.prepare("SELECT count(*) AS n FROM acceptance_notifications WHERE swarm_id = ?").get(id)?.n);
}

it("quiescence wakes just one equal peer, then may finish honestly unchecked", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  const result = await startSwarm(run.env, { name: "no volunteer", taskPrompt: "Work.", agentAmount: 2 }, {});
  assert.equal(result.end, "finished");
  assert.equal(result.acceptance.verdict, "unchecked");
  assert.equal(notices(run, result.swarm.id), 1);
  assert.equal(promptTexts(run.fake).length, 3, "two kickoffs, one checkpoint, no repeated review round");
});

for (const verdict of ["accepted", "incomplete", "blocked"] as const) {
  it(`a voluntary ${verdict} judgment finishes without an automatic wake`, { timeout: 10_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const outcome = startSwarm(run.env, { name: verdict, taskPrompt: "Work.", agentAmount: 1 }, {});
    const id = newestSwarmId(run.db);
    const [agent] = agentNames(run.db, id);
    await waitFor(() => agentStatus(run.db, id, agent) === "idle", "idle before judgment");
    mutateAcceptance(run.db, id, agent, { action: "claim", revision: 0 }, Date.now());
    mutateAcceptance(
      run.db,
      id,
      agent,
      { action: "update", revision: 1, verdict, payload: verdict === "accepted" ? accepted : incomplete },
      Date.now(),
    );
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.acceptance.verdict, verdict);
    assert.equal(notices(run, id), 0);
  });
}

it("a check that settles without judgment becomes incomplete after the one wake", { timeout: 10_000 }, async () => {
  const run = createRunFixture({ runs: [[{ type: "reply" }], [{ type: "wait", ms: 200 }, { type: "reply" }]] });
  fixture = run;
  const outcome = startSwarm(run.env, { name: "unfinished check", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  const [agent] = agentNames(run.db, id);
  await waitFor(() => notices(run, id) === 1, "checkpoint queued");
  mutateAcceptance(run.db, id, agent, { action: "claim", revision: 0 }, Date.now());
  const result = await outcome;
  assert.equal(result.acceptance.verdict, "incomplete");
  assert.equal(result.acceptance.claimant, null);
  assert.match(result.acceptance.findings.join("\n"), /settled without a final judgment/);
  assert.equal(notices(run, id), 1);
});

it("checker crash invalidates its claim even when no peers can be woken", { timeout: 10_000 }, async () => {
  const run = createRunFixture(
    {
      runs: [
        [{ type: "reply" }],
        [
          { type: "wait", ms: 300 },
          { type: "exit", code: 3, stderr: "checker failed" },
        ],
      ],
    },
    { timings: { reviveBackoffMs: [] } },
  );
  fixture = run;
  const outcome = startSwarm(run.env, { name: "failed check", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  const [agent] = agentNames(run.db, id);
  await waitFor(() => notices(run, id) === 1, "checkpoint queued");
  mutateAcceptance(run.db, id, agent, { action: "claim", revision: 0 }, Date.now());
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.equal(result.acceptance.verdict, "incomplete");
  assert.match(result.acceptance.findings.join("\n"), /Checker crashed/);
  assert.equal(notices(run, id), 1);
});

it("resume invalidates old acceptance and permits one new bounded checkpoint", { timeout: 10_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle);
  fixture = run;
  const first = startSwarm(run.env, { name: "resumed", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  const [agent] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, agent) === "idle", "first run idle");
  mutateAcceptance(run.db, id, agent, { action: "claim", revision: 0 }, Date.now());
  mutateAcceptance(
    run.db,
    id,
    agent,
    { action: "update", revision: 1, verdict: "accepted", payload: accepted },
    Date.now(),
  );
  assert.equal((await first).acceptance.verdict, "accepted");
  const second = resumeSwarm(run.env, { swarmId: id, message: "Recheck against changed inputs." }, {});
  assert.equal(inspectAcceptance(run.db, id).verdict, "unchecked");
  const result = await second;
  assert.equal(result.run, 2);
  assert.equal(result.acceptance.verdict, "unchecked");
  assert.equal(result.acceptance.evidence.length, 1, "old evidence retained but not endorsed");
  assert.equal(notices(run, id), 1);
});

it(
  "natural closure rejects cross-connection acceptance and makes late messages explicitly undeliverable",
  { timeout: 15_000 },
  async () => {
    const run = createRunFixture({ ignoreSigterm: true });
    fixture = run;
    const outcome = startSwarm(run.env, { name: "close race", taskPrompt: "Work.", agentAmount: 1 }, {});
    const id = newestSwarmId(run.db);
    const [agent] = agentNames(run.db, id);
    await waitFor(() => agentStatus(run.db, id, agent) === "idle", "agent idle");
    mutateAcceptance(run.db, id, agent, { action: "claim", revision: 0 }, Date.now());
    mutateAcceptance(
      run.db,
      id,
      agent,
      { action: "update", revision: 1, verdict: "accepted", payload: accepted },
      Date.now(),
    );
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
            { action: "challenge", revision: 2, finding: "New input needs rechecking." },
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
    assert.equal(result.acceptance.revision, 2);
    assert.equal(result.end, "finished");
  },
);

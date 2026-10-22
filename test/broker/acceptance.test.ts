import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, it } from "node:test";
import { Value } from "typebox/value";
import {
  inspectAcceptance,
  invalidateAgentVote,
  mutateAcceptance,
  resetAcceptanceVotes,
  sealAcceptance,
} from "../../src/broker/acceptance.js";
import type { AcceptanceVoteVerdict } from "../../src/store/acceptance-types.js";
import { acceptanceToolParameters, executeAcceptanceTool } from "../../src/tools/acceptance-tool.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function vote(id: number, agent: string, verdict: AcceptanceVoteVerdict, reason = "Checked the original task.") {
  return mutateAcceptance(db, id, agent, { action: "vote", verdict, reason }, T0);
}

it("starts unchecked with the original task, persisted criteria and no votes", () => {
  const { id } = seedSwarm(db);
  const criteria = ["Output matches docs/req.md", "Tests pass"];
  db.sql.prepare("UPDATE swarms SET acceptance_criteria = ? WHERE id = ?").run(JSON.stringify(criteria), id);
  const record = inspectAcceptance(db, id);
  assert.equal(record.verdict, "unchecked");
  assert.equal(record.revision, 0);
  assert.equal(record.originalTask, "Build the thing. Requirements: docs/req.md");
  assert.deepEqual(record.acceptanceCriteria, criteria);
  assert.deepEqual(record.votes, []);
  assert.deepEqual(record.counts, { accepted: 0, incomplete: 0, blocked: 0 });
  assert.equal(record.totalAgents, 3);
  assert.equal(record.threshold, 3);
  assert.equal(record.updatedBy, null);
});

it("uses ceil of 70 percent of registered agents, never configured amount or active agents", () => {
  for (const totalAgents of [0, 1, 2, 3, 4, 5, 7, 10, 11]) {
    const agents = Array.from({ length: totalAgents }, (_, i) => `Agent${i}`);
    const { id } = seedSwarm(db, { agents });
    db.sql.prepare("UPDATE swarms SET agent_amount = 100 WHERE id = ?").run(id);
    db.sql.prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND kind = 'agent'").run(id);
    const threshold = Math.ceil(totalAgents * 0.7);
    assert.equal(inspectAcceptance(db, id).totalAgents, totalAgents);
    assert.equal(inspectAcceptance(db, id).threshold, threshold);
    if (totalAgents === 0) assert.equal(inspectAcceptance(db, id).verdict, "unchecked");
    for (const [index, agent] of agents.entries()) {
      const record = vote(id, agent, "accepted");
      assert.equal(record.verdict, index + 1 >= threshold ? "accepted" : "incomplete");
    }
  }
});

it("excludes Watcher from the electorate and ignores any stored Watcher vote", () => {
  const { id } = seedSwarm(db, { agents: ["Maria", "John"] });
  db.sql
    .prepare(
      "INSERT INTO acceptance_votes (swarm_id, agent, run, verdict, reason, updated_at) VALUES (?, 'Watcher', 1, 'accepted', 'Observed', ?)",
    )
    .run(id, T0);
  const initial = inspectAcceptance(db, id);
  assert.equal(initial.totalAgents, 2);
  assert.equal(initial.threshold, 2);
  assert.deepEqual(initial.votes, []);
  assert.equal(initial.verdict, "unchecked");
  assert.throws(() => vote(id, "Watcher", "accepted"), /worker agent/);
  assert.equal(vote(id, "Maria", "accepted").verdict, "incomplete");
  assert.equal(vote(id, "John", "accepted").verdict, "accepted");
});

it("accepted and blocked votes cannot combine into a terminal quorum", () => {
  const { id } = seedSwarm(db, { agents: ["Maria", "John", "Liam", "Jane", "Alex"] });
  vote(id, "Maria", "accepted");
  vote(id, "John", "accepted");
  vote(id, "Liam", "blocked");
  vote(id, "Jane", "blocked");
  const split = vote(id, "Alex", "incomplete");
  assert.equal(split.verdict, "incomplete");
  assert.deepEqual(split.counts, { accepted: 2, incomplete: 1, blocked: 2 });
  vote(id, "Maria", "blocked");
  assert.equal(vote(id, "John", "blocked").verdict, "blocked");
  vote(id, "Liam", "accepted");
  assert.equal(vote(id, "Jane", "accepted").verdict, "incomplete");
});

it("keeps one replaceable vote per canonical agent with a free-form reason", () => {
  const { id } = seedSwarm(db);
  vote(id, "maria", "accepted");
  const record = mutateAcceptance(
    db,
    id,
    "MARIA",
    { action: "vote", verdict: "incomplete", reason: "  Need the supplied input file.\nNo assessment attached.  " },
    T0 + 1,
  );
  assert.equal(record.revision, 2);
  assert.equal(record.updatedBy, "Maria");
  assert.equal(record.updatedAt, T0 + 1);
  assert.deepEqual(record.votes, [
    {
      agent: "Maria",
      run: 1,
      verdict: "incomplete",
      reason: "Need the supplied input file.\nNo assessment attached.",
      updatedAt: T0 + 1,
    },
  ]);
  assert.deepEqual(record.counts, { accepted: 0, incomplete: 1, blocked: 0 });
  assert.equal(
    db.sql.prepare("SELECT count(*) AS n FROM events WHERE swarm_id = ? AND type = 'acceptance.updated'").get(id)?.n,
    2,
  );
});

it("incomplete quorum never terminates, and no structured evidence or criteria assessment is required", () => {
  const { id } = seedSwarm(db);
  for (const agent of ["Maria", "John", "Liam"]) vote(id, agent, "incomplete", "Still working");
  assert.equal(inspectAcceptance(db, id).verdict, "incomplete");
  for (const agent of ["Maria", "John", "Liam"]) vote(id, agent, "accepted", "Done");
  assert.equal(inspectAcceptance(db, id).verdict, "accepted");
});

it("revisions are optional, but supplied stale or invalid revisions roll back", () => {
  const { id } = seedSwarm(db);
  vote(id, "Maria", "accepted");
  for (const revision of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => mutateAcceptance(db, id, "John", { action: "vote", revision, verdict: "accepted", reason: "Done" }, T0),
      /Stale/,
    );
  }
  assert.equal(inspectAcceptance(db, id).votes.length, 1);
  assert.equal(inspectAcceptance(db, id).revision, 1);
  mutateAcceptance(db, id, "John", { action: "vote", revision: 1, verdict: "blocked", reason: "Missing access" }, T0);
});

it("concurrent peer votes persist without a shared revision bottleneck", async () => {
  const { id } = seedSwarm(db);
  const run = promisify(execFile);
  const results = await Promise.all(
    ["Maria", "John", "Liam"].map((agent) =>
      run(
        process.execPath,
        ["--import", "tsx/esm", "test/broker/fixtures/acceptance-vote.ts", db.path, String(id), agent],
        { timeout: 10_000 },
      ),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.stdout),
    ["voted", "voted", "voted"],
  );
  const record = inspectAcceptance(db, id);
  assert.equal(record.revision, 3);
  assert.equal(record.votes.length, 3);
  assert.equal(record.verdict, "accepted");
});

it("rejects blank reasons, unknown agents and non-agent votes without changing state", () => {
  const { id } = seedSwarm(db);
  for (const reason of ["", " \n\t"]) assert.throws(() => vote(id, "Maria", "accepted", reason), /nonempty/);
  for (const actor of ["User", "Main", "System", "Nobody", "Watcher", "watcher"]) {
    assert.throws(() => vote(id, actor, "accepted"), /agent|Unknown participant/);
  }
  assert.equal(inspectAcceptance(db, id).revision, 0);
  assert.equal(inspectAcceptance(db, id).votes.length, 0);
});

it("the tool exposes inspect and vote only, validating action-specific inputs", () => {
  const { id } = seedSwarm(db);
  for (const action of ["claim", "release", "challenge", "update"]) {
    assert.equal(Value.Check(acceptanceToolParameters, { action }), false);
  }
  assert.equal(executeAcceptanceTool(db, id, "Maria", { action: "inspect" }, T0, 1).verdict, "unchecked");
  assert.throws(() => executeAcceptanceTool(db, id, "Maria", { action: "vote" }, T0, 1), /Invalid/);
  assert.throws(
    () => executeAcceptanceTool(db, id, "Maria", { action: "vote", verdict: "accepted", reason: "  " }, T0, 1),
    /Invalid/,
  );
  const record = executeAcceptanceTool(
    db,
    id,
    "Maria",
    { action: "vote", verdict: "blocked", reason: "Need credentials" },
    T0,
    1,
  );
  assert.equal(record.votes[0]?.reason, "Need credentials");
  assert.equal(record.verdict, "incomplete");
});

it("crashes remove only that agent's current unsealed vote and emit one change", () => {
  const { id } = seedSwarm(db);
  for (const agent of ["Maria", "John", "Liam"]) vote(id, agent, "accepted");
  assert.equal(invalidateAgentVote(db, id, 2, "Maria", "Process died", T0), false);
  assert.throws(() => invalidateAgentVote(db, id, 1, "Maria", " ", T0), /reason/);
  assert.equal(invalidateAgentVote(db, id, 1, "maria", "Process died", T0 + 1), true);
  assert.equal(invalidateAgentVote(db, id, 1, "Maria", "Process died", T0), false);
  const record = inspectAcceptance(db, id);
  assert.equal(record.verdict, "incomplete");
  assert.equal(record.revision, 4);
  assert.equal(record.updatedBy, "System");
  assert.deepEqual(
    record.votes.map((item) => item.agent),
    ["John", "Liam"],
  );
});

it("reset removes old-run votes and keeps admission sealing under runner control", () => {
  const { id } = seedSwarm(db);
  vote(id, "Maria", "accepted");
  sealAcceptance(db, id, 1, 1);
  const reset = resetAcceptanceVotes(db, id, T0 + 1);
  assert.equal(reset.verdict, "unchecked");
  assert.equal(reset.revision, 2);
  assert.deepEqual(reset.votes, []);
  assert.throws(() => vote(id, "Maria", "accepted"), /closed/);
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(id);
  db.sql.prepare("INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (?, 2, ?)").run(id, T0 + 2);
  assert.equal(vote(id, "Maria", "accepted").votes[0]?.run, 2);
  assert.equal(invalidateAgentVote(db, id, 1, "Maria", "Old callback", T0), false);
});

it("inspection excludes previous-run votes even before reset", () => {
  const { id } = seedSwarm(db);
  vote(id, "Maria", "accepted");
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(id);
  db.sql.prepare("INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (?, 2, ?)").run(id, T0 + 1);
  assert.equal(inspectAcceptance(db, id).verdict, "unchecked");
  assert.equal(vote(id, "Maria", "blocked").votes.length, 1);
});

it("sealing checks revision and run atomically and protects votes during shutdown", () => {
  const { id } = seedSwarm(db);
  for (const agent of ["Maria", "John", "Liam"]) vote(id, agent, "accepted");
  assert.throws(() => sealAcceptance(db, id, 1, 2), /Stale/);
  assert.throws(() => sealAcceptance(db, id, 2, 3), /Run changed/);
  const record = inspectAcceptance(db, id);
  sealAcceptance(db, id, 1, 3);
  sealAcceptance(db, id, 1, 3);
  assert.throws(() => sealAcceptance(db, id, 1, 2), /Stale/);
  assert.throws(() => sealAcceptance(db, id, 2, 3), /Run changed/);
  db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(id);
  db.sql.prepare("UPDATE swarm_runs SET ended_at = ? WHERE swarm_id = ?").run(T0, id);
  sealAcceptance(db, id, 1, 3);
  assert.throws(() => vote(id, "Maria", "incomplete"), /closed/);
  assert.equal(invalidateAgentVote(db, id, 1, "Maria", "Shutdown", T0), false);
  assert.deepEqual(inspectAcceptance(db, id), record);
});

it("checks an optional expected run atomically before persisting a vote", () => {
  const { id } = seedSwarm(db);
  const mutation = { action: "vote", verdict: "accepted", reason: "Done" } as const;
  for (const run of [0, -1, 2, 1.5, Number.NaN]) {
    assert.throws(() => mutateAcceptance(db, id, "Maria", mutation, T0, run), /different swarm run/);
  }
  assert.equal(inspectAcceptance(db, id).revision, 0);
  assert.deepEqual(inspectAcceptance(db, id).votes, []);
  assert.equal(mutateAcceptance(db, id, "Maria", mutation, T0, 1).votes[0]?.run, 1);
  assert.throws(
    () =>
      executeAcceptanceTool(db, id, "John", { action: "vote", verdict: "accepted", reason: "Done" }, T0, Number.NaN),
    /valid agent run identity/,
  );
});

it("stopped swarms and ended runs reject votes", () => {
  for (const close of [
    (id: number) => db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(id),
    (id: number) => db.sql.prepare("UPDATE swarm_runs SET ended_at = ? WHERE swarm_id = ?").run(T0, id),
  ]) {
    const { id } = seedSwarm(db);
    close(id);
    assert.throws(() => vote(id, "Maria", "accepted"), /closed/);
    assert.equal(inspectAcceptance(db, id).revision, 0);
  }
});

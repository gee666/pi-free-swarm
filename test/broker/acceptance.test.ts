import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, it } from "node:test";
import {
  inspectAcceptance,
  invalidateAcceptanceClaim,
  mutateAcceptance,
  sealAcceptance,
} from "../../src/broker/acceptance.js";
import { notifyPendingAcceptance } from "../../src/broker/acceptance-checkpoint.js";
import { executeAcceptanceTool } from "../../src/tools/acceptance-tool.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const legacy = seedSwarm(db);
const accepted = {
  evidence: [
    {
      reference: "test-report.txt",
      result: "Passed supplied checks; original requirements inspected",
      command: "npm test",
      cwd: "/workspace",
    },
  ],
  knownGaps: [],
  findings: [],
};
const incomplete = {
  evidence: [{ reference: "requirements.md#output", result: "Output differs" }],
  knownGaps: ["Output mismatch"],
  findings: ["Fix output semantics against requirement"],
};

it("creates unchecked records with the authoritative task", () => {
  for (const swarm of [legacy, seedSwarm(db)]) {
    const record = inspectAcceptance(db, swarm.id);
    assert.equal(record.verdict, "unchecked");
    assert.equal(record.revision, 0);
    assert.equal(record.originalTask, "Build the thing. Requirements: docs/req.md");
    assert.equal(record.claimant, null);
  }
});

it("two processes claiming the same revision have exactly one winner", async () => {
  const swarm = seedSwarm(db);
  const run = promisify(execFile);
  const results = await Promise.all(
    ["Maria", "John"].map((agent) =>
      run(process.execPath, [
        "--import",
        "tsx/esm",
        "test/broker/fixtures/acceptance-claim.ts",
        db.path,
        String(swarm.id),
        agent,
      ]),
    ),
  );
  assert.deepEqual(results.map((r) => r.stdout).sort(), ["claimed", "stale"]);
  assert.equal(inspectAcceptance(db, swarm.id).revision, 1);
});

it("identical peer capabilities, claim ownership and revisions guard updates and release", () => {
  const { id } = seedSwarm(db);
  mutateAcceptance(db, id, "maria", { action: "claim", revision: 0 }, T0);
  assert.throws(() => mutateAcceptance(db, id, "John", { action: "release", revision: 1 }, T0), /Self-claim/);
  mutateAcceptance(db, id, "Maria", { action: "release", revision: 1 }, T0);
  mutateAcceptance(db, id, "John", { action: "claim", revision: 2 }, T0);
  assert.throws(
    () =>
      mutateAcceptance(db, id, "Maria", { action: "update", revision: 1, verdict: "accepted", payload: accepted }, T0),
    /Stale/,
  );
  const record = mutateAcceptance(
    db,
    id,
    "John",
    { action: "update", revision: 3, verdict: "accepted", payload: accepted },
    T0,
  );
  assert.equal(record.verdict, "accepted");
  assert.equal(record.claimant, null);
  assert.equal(db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(id)?.status, "starting");
});

it("requires evidence and explicit gaps; never accepts unresolved findings", () => {
  const { id } = seedSwarm(db);
  mutateAcceptance(db, id, "Maria", { action: "claim", revision: 0 }, T0);
  for (const payload of [
    { ...accepted, evidence: [] },
    incomplete,
    { ...accepted, evidence: [{ reference: "log", result: "pass", command: "test" }] },
  ]) {
    assert.throws(() =>
      mutateAcceptance(db, id, "Maria", { action: "update", revision: 1, verdict: "accepted", payload }, T0),
    );
    assert.equal(inspectAcceptance(db, id).revision, 1);
  }
  assert.throws(
    () =>
      executeAcceptanceTool(
        db,
        id,
        "Maria",
        { action: "update", revision: 1, verdict: "blocked", payload: accepted },
        T0,
      ),
    /concrete/,
  );
  const result = executeAcceptanceTool(
    db,
    id,
    "Maria",
    { action: "update", revision: 1, verdict: "blocked", payload: incomplete },
    T0,
  );
  assert.equal(result.verdict, "blocked");
  assert.equal(notifyPendingAcceptance(db, id, 1, ["Maria"], T0), null);
});

it("new actionable findings challenge accepted and reject stale evidence", () => {
  const { id } = seedSwarm(db);
  mutateAcceptance(db, id, "Maria", { action: "claim", revision: 0 }, T0);
  mutateAcceptance(db, id, "Maria", { action: "update", revision: 1, verdict: "accepted", payload: accepted }, T0);
  const challenged = mutateAcceptance(
    db,
    id,
    "John",
    {
      action: "challenge",
      revision: 2,
      finding: "Artifact changed after recorded test: rerun checks for current inputs.",
    },
    T0,
  );
  assert.equal(challenged.verdict, "incomplete");
  assert.equal(challenged.evidence.length, 1);
  assert.throws(
    () =>
      mutateAcceptance(db, id, "Maria", { action: "update", revision: 1, verdict: "accepted", payload: accepted }, T0),
    /Stale/,
  );
  assert.throws(
    () => mutateAcceptance(db, id, "John", { action: "challenge", revision: 3, finding: challenged.findings[0] }, T0),
    /already/,
  );
});

it("one targeted durable notification per run, rotating attention without claiming", () => {
  const { id } = seedSwarm(db);
  db.sql.prepare("UPDATE participants SET status = 'idle' WHERE swarm_id = ? AND kind = 'agent'").run(id);
  assert.equal(notifyPendingAcceptance(db, id, 1, [], T0), null);
  assert.equal(notifyPendingAcceptance(db, id, 1, ["Maria", "John", "Liam"], T0)?.recipient, "Maria");
  assert.equal(notifyPendingAcceptance(db, id, 1, ["Maria", "John", "Liam"], T0), null);
  assert.equal(inspectAcceptance(db, id).verdict, "unchecked");
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM message_recipients WHERE swarm_id = ?").get(id)?.n, 1);
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(id);
  db.sql.prepare("INSERT INTO swarm_runs (swarm_id, run, started_at) VALUES (?, 2, ?)").run(id, T0);
  assert.equal(notifyPendingAcceptance(db, id, 1, ["Maria"], T0), null);
  assert.equal(notifyPendingAcceptance(db, id, 2, ["Maria", "John", "Liam"], T0)?.recipient, "John");
});

it("checker death becomes incomplete without automatic reassignment", () => {
  const { id } = seedSwarm(db);
  mutateAcceptance(db, id, "Maria", { action: "claim", revision: 0 }, T0);
  assert.equal(invalidateAcceptanceClaim(db, id, 2, "Maria", "Process died", T0), false);
  assert.equal(invalidateAcceptanceClaim(db, id, 1, "Maria", "Process died before judgment", T0), true);
  assert.equal(invalidateAcceptanceClaim(db, id, 1, "Maria", "Process died", T0), false);
  const record = inspectAcceptance(db, id);
  assert.equal(record.verdict, "incomplete");
  assert.equal(record.claimant, null);
  assert.ok(record.knownGaps.length);
  assert.equal(notifyPendingAcceptance(db, id, 1, ["John"], T0), null);
  mutateAcceptance(db, id, "John", { action: "claim", revision: record.revision }, T0);
});

it("closure checks revision atomically and rejects later writes; stop cannot wake", () => {
  const { id } = seedSwarm(db);
  mutateAcceptance(db, id, "Maria", { action: "claim", revision: 0 }, T0);
  assert.throws(() => sealAcceptance(db, id, 1, 0), /Stale/);
  sealAcceptance(db, id, 1, 1);
  assert.throws(() => mutateAcceptance(db, id, "Maria", { action: "release", revision: 1 }, T0), /closed/);
  assert.equal(notifyPendingAcceptance(db, id, 1, ["Maria"], T0), null);
  const stopped = seedSwarm(db);
  db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(stopped.id);
  assert.equal(notifyPendingAcceptance(db, stopped.id, 1, ["Maria"], T0), null);
  assert.throws(() => mutateAcceptance(db, stopped.id, "Maria", { action: "claim", revision: 0 }, T0), /closed/);
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { createSwarm } from "../../src/broker/swarms.js";
import { executeAcceptanceTool } from "../../src/tools/acceptance-tool.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { buildRunResultText } from "../../src/tools/result.js";
import { formatAgentVoteResult } from "../../src/tools/agent-vote-result.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 1000, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };
function tools(swarmId: number, name = "Maria") {
  return createAgentToolHandlers({ getDb: () => db, swarmId, run: 1, agentName: name, clock });
}

test("successful long-task vote keeps own judgment, tally and revision without repeating shared context", () => {
  const task = "Long authoritative task requirement. ".repeat(2500);
  const criteria = ["Required observable deliverable and evidence. ".repeat(400)];
  const peerReason = "Other worker's independent evidence. ".repeat(200);
  const swarm = createSwarm(db, {
    name: "long vote",
    taskPrompt: task,
    acceptanceCriteria: criteria,
    agentNames: ["Maria", "John", "Liam"],
    runnerPid: process.pid,
    now: T0,
  });
  mutateAcceptance(db, swarm.id, "John", { action: "vote", verdict: "blocked", reason: peerReason }, T0 + 1);
  const agent = tools(swarm.id, "maria");
  const reason = "Own evidence checked.\nArtifacts: docs/result.md";
  const text = agent.acceptance({ action: "vote", verdict: "accepted", reason: `  ${reason}  ` });
  const record = inspectAcceptance(db, swarm.id);
  const response: unknown = JSON.parse(text);
  assert.deepEqual(response, {
    swarmId: swarm.id,
    revision: record.revision,
    verdict: record.verdict,
    vote: { agent: "Maria", run: 1, verdict: "accepted", reason },
    counts: record.counts,
    threshold: record.threshold,
    totalAgents: record.totalAgents,
  });
  assert.doesNotMatch(text, /"originalTask"|"acceptanceCriteria"|"votes"/);
  assert.ok(!text.includes(peerReason));
  const full = agent.acceptance({ action: "inspect" });
  assert.deepEqual(JSON.parse(full), record);
  assert.ok(full.includes(task.trim()));
  assert.ok(full.includes(criteria[0].trim()));
  const fullBytes = Buffer.byteLength(full);
  const compactBytes = Buffer.byteLength(text);
  assert.ok(compactBytes < fullBytes / 100);
  console.log(
    JSON.stringify({
      measured: "serialized JSON before outer output bound",
      fullBytes,
      compactBytes,
      savedBytes: fullBytes - compactBytes,
      reductionPercent: ((1 - compactBytes / fullBytes) * 100).toFixed(2),
    }),
  );
  const apiResult = executeAcceptanceTool(
    db,
    swarm.id,
    "Liam",
    {
      action: "vote",
      verdict: "incomplete",
      reason: "Third worker remains unfinished.",
    },
    T0 + 1000,
    1,
  );
  assert.equal(apiResult.originalTask, task.trim());
  assert.deepEqual(
    apiResult.acceptanceCriteria,
    criteria.map((item) => item.trim()),
  );
  assert.equal(apiResult.votes.find((vote) => vote.agent === "John")?.reason, peerReason.trim());
  const final = buildRunResultText(db, { swarm, run: 1, end: "finished", acceptance: apiResult }, null, T0 + 1000);
  assert.ok(final.includes(task.trim()));
  assert.ok(final.includes(criteria[0].trim()));
  assert.ok(final.includes(peerReason.trim()));
  assert.ok(final.includes(reason));
});

test("all successful verdicts remain authoritative while invalid/stale calls still fail unchanged", () => {
  for (const verdict of ["accepted", "incomplete", "blocked"] as const) {
    const swarm = seedSwarm(db);
    const agent = tools(swarm.id);
    const text = agent.acceptance({ action: "vote", verdict, reason: `Evidence for ${verdict}` });
    const snapshot = inspectAcceptance(db, swarm.id);
    const own = snapshot.votes.find((vote) => vote.agent === "Maria");
    assert.equal(own?.verdict, verdict);
    assert.equal(own?.reason, `Evidence for ${verdict}`);
    assert.ok(text.includes(`"verdict":"${verdict}"`));
    assert.throws(() => agent.acceptance({ action: "vote", verdict }), /reason is required/);
    assert.throws(
      () => agent.acceptance({ action: "vote", verdict, reason: "Again", revision: 0 }),
      /revision|changed|stale/i,
    );
    assert.deepEqual(inspectAcceptance(db, swarm.id), snapshot);
  }
});

test("an inconsistent response directs inspection, never an automatic write retry", () => {
  const swarm = seedSwarm(db);
  assert.throws(
    () => formatAgentVoteResult(inspectAcceptance(db, swarm.id), "Unknown"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Inspect current votes/);
      assert.doesNotMatch(error.message, /retry|resubmit|vote again/i);
      return true;
    },
  );
});

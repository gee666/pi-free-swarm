import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, it } from "node:test";
import { inspectAcceptance } from "../../src/broker/acceptance.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { initialWallCursor } from "../../src/broker/wall-delta.js";
import { bodyCeiling, TEXT_MAX } from "../../src/limits.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { agentToolResult } from "../../src/tools/agent-tool-result.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 100, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };

it("routes after to delta retrieval and returns reusable cursors for old-post comments", () => {
  const swarm = seedSwarm(db);
  const tools = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria", clock });
  const body = "x".repeat(bodyCeiling(TEXT_MAX));
  const postResult = tools.post({ title: "Large body", text: body });
  const postId = Number(/#(\d+)/.exec(postResult)?.[1]);
  const first = tools.readPosts({ after: initialWallCursor(swarm.id), count: 1 });
  assert.match(first, new RegExp(`Post #${postId}: Large body`));
  assert.ok(first.includes(body), "stored bodies are listed whole");
  const after = /Next cursor: (\S+)/.exec(first)?.[1];
  assert.ok(after);
  tools.comment({ post_id: postId, text: "Updated evidence" });
  const delta = tools.readPosts({ after, count: 1 });
  assert.match(delta, /Comment #\d+ on post #\d+ · Maria: Updated evidence/);
  assert.doesNotMatch(delta, /Large body/);
  const next = /Next cursor: (\S+)/.exec(delta)?.[1];
  assert.ok(next);
  assert.match(tools.readPosts({ after: next }), /^No wall changes./);
  assert.ok(tools.readPost({ post_id: postId }).includes(body));
});

it("binds votes to each peer and replaces votes without inflating quorum", () => {
  const swarm = seedSwarm(db);
  const peer = (agentName: string) =>
    createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName, clock });
  const maria = peer("Maria");
  const john = peer("John");
  const liam = peer("Liam");
  const initial = inspectAcceptance(db, swarm.id);
  assert.match(maria.acceptance({ action: "inspect" }), /"verdict":"unchecked"/);
  assert.equal(initial.totalAgents, 3);
  assert.equal(initial.threshold, 3);
  assert.deepEqual(initial.votes, []);
  assert.deepEqual(initial.counts, { accepted: 0, incomplete: 0, blocked: 0 });
  assert.deepEqual(initial.acceptanceCriteria, swarm.acceptanceCriteria);
  assert.equal(initial.originalTask, swarm.taskPrompt);
  assert.throws(() => maria.acceptance({ action: "vote", verdict: "accepted" }), /Invalid acceptance operation/);
  assert.throws(
    () => maria.acceptance({ action: "vote", verdict: "accepted", reason: "   " }),
    /Invalid acceptance operation/,
  );
  maria.acceptance({ action: "vote", verdict: "incomplete", reason: " Browser check missing. " });
  john.acceptance({ action: "vote", verdict: "accepted", reason: "Tests pass." });
  maria.acceptance({ action: "vote", verdict: "accepted", reason: "Browser check now passes." });
  const pending = inspectAcceptance(db, swarm.id);
  assert.equal(pending.verdict, "incomplete");
  assert.equal(pending.votes.length, 2);
  assert.deepEqual(pending.counts, { accepted: 2, incomplete: 0, blocked: 0 });
  assert.equal(pending.votes.find((vote) => vote.agent === "Maria")?.reason, "Browser check now passes.");
  liam.acceptance({ action: "vote", verdict: "accepted", reason: "All requirements checked." });
  assert.equal(inspectAcceptance(db, swarm.id).verdict, "accepted");
  john.acceptance({ action: "vote", verdict: "blocked", reason: "Deployment credentials unavailable." });
  const updated = inspectAcceptance(db, swarm.id);
  assert.equal(updated.verdict, "incomplete");
  assert.deepEqual(updated.counts, { accepted: 2, incomplete: 0, blocked: 1 });
  assert.equal(updated.votes.find((vote) => vote.agent === "John")?.reason, "Deployment credentials unavailable.");
});

it("requires a registered agent for votes and a registered participant for inspection", () => {
  const swarm = seedSwarm(db);
  const peer = (agentName: string) =>
    createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName, clock });
  for (const name of ["Watcher", "User"]) {
    const tools = peer(name);
    assert.match(tools.acceptance({ action: "inspect" }), /"totalAgents":3/);
    assert.throws(
      () => tools.acceptance({ action: "vote", verdict: "accepted", reason: "Looks good." }),
      /require a worker agent/,
    );
  }
  assert.throws(() => peer("Unknown").acceptance({ action: "inspect" }), /Unknown participant/);
  const absent = createAgentToolHandlers({ getDb: () => db, swarmId: 999999, run: 1, agentName: "Maria", clock });
  assert.throws(() => absent.acceptance({ action: "inspect" }), /Unknown participant: Maria/);
});

it("rejects stale worker votes after resume using the run captured by its tool handler", () => {
  const swarm = seedSwarm(db, { agents: ["Maria"] });
  const peer = (run: number) =>
    createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run, agentName: "Maria", clock });
  const oldWorker = peer(1);
  oldWorker.acceptance({ action: "vote", verdict: "accepted", reason: "Run one passed." });
  endRun(db, swarm.id, process.pid, "stopped", T0 + 1);
  const resumed = beginResume(db, swarm.id, process.pid, T0 + 2);
  const before = inspectAcceptance(db, swarm.id);
  assert.equal(resumed.run, 2);
  assert.equal(before.verdict, "unchecked");
  const staleVote = () => oldWorker.acceptance({ action: "vote", verdict: "blocked", reason: "Stale process." });
  assert.throws(staleVote, /different swarm run/);
  assert.deepEqual(inspectAcceptance(db, swarm.id), before);
  peer(resumed.run).acceptance({ action: "vote", verdict: "accepted", reason: "Run two passed." });
  const current = inspectAcceptance(db, swarm.id);
  assert.equal(current.verdict, "accepted");
  assert.equal(current.votes[0]?.run, 2);
  assert.throws(staleVote, /different swarm run/);
  assert.deepEqual(inspectAcceptance(db, swarm.id), current);
});

it("bounds tool context while preserving full oversized results and cursors in a readable file", async () => {
  assert.deepEqual(await agentToolResult("small"), { content: [{ type: "text", text: "small" }], details: undefined });
  const original = `${"😀".repeat(1000)}\n`.repeat(3000) + "Next cursor: opaque";
  const result = await agentToolResult(original);
  assert.ok(result.details);
  const file = result.details.fullOutputPath;
  try {
    assert.equal(await readFile(file, "utf8"), original);
    const content = result.content[0];
    assert.ok(content.type === "text");
    assert.match(content.text, /Truncated. Full result, including any continuation cursor:/);
    assert.ok(Buffer.byteLength(content.text) < 52_000);
  } finally {
    await rm(path.dirname(file), { recursive: true, force: true });
  }
});

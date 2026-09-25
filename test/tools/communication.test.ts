import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, it } from "node:test";
import { inspectAcceptance } from "../../src/broker/acceptance.js";
import { initialWallCursor } from "../../src/broker/wall-delta.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { agentToolResult } from "../../src/tools/agent-tool-result.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 100, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };

it("routes after to delta retrieval and returns reusable cursors for old-post comments", () => {
  const swarm = seedSwarm(db);
  const tools = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, agentName: "Maria", clock });
  const postResult = tools.post({ title: "Large body", text: "x".repeat(4000) });
  const postId = Number(/#(\d+)/.exec(postResult)?.[1]);
  const first = tools.readPosts({ after: initialWallCursor(swarm.id), count: 1 });
  assert.match(first, new RegExp(`Post #${postId}: Large body`));
  assert.match(first, /read post #\d+ for full text/);
  const after = /Next cursor: (\S+)/.exec(first)?.[1];
  assert.ok(after);
  tools.comment({ post_id: postId, text: "Updated evidence" });
  const delta = tools.readPosts({ after, count: 1 });
  assert.match(delta, /Comment #\d+ on post #\d+ · Maria: Updated evidence/);
  assert.doesNotMatch(delta, /Large body/);
  const next = /Next cursor: (\S+)/.exec(delta)?.[1];
  assert.ok(next);
  assert.match(tools.readPosts({ after: next }), /^No wall changes./);
  assert.match(tools.readPost({ post_id: postId }), new RegExp("x".repeat(4000)));
});

it("binds acceptance mutations to each peer's identity and propagates stale/ownership errors", () => {
  const swarm = seedSwarm(db);
  const peer = (agentName: string) => createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, agentName, clock });
  const maria = peer("Maria");
  const john = peer("John");
  assert.match(maria.acceptance({ action: "inspect" }), /"verdict":"unchecked"/);
  assert.throws(() => maria.acceptance({ action: "claim" }), /Invalid acceptance operation/);
  assert.throws(() => maria.acceptance({ action: "update", revision: 0 }), /Invalid acceptance operation/);
  assert.match(maria.acceptance({ action: "claim", revision: 0 }), /"claimant":"Maria"/);
  assert.throws(() => john.acceptance({ action: "claim", revision: 0 }), /revision/i);
  assert.throws(() => john.acceptance({ action: "release", revision: 1 }), /claim/i);
  maria.acceptance({ action: "release", revision: 1 });
  assert.match(john.acceptance({ action: "claim", revision: 2 }), /"claimant":"John"/);
  john.acceptance({
    action: "update",
    revision: 3,
    verdict: "accepted",
    payload: {
      evidence: [{ reference: "evidence/test.log", result: "Original requirements checked and tests passed" }],
      findings: [],
      knownGaps: [],
    },
  });
  assert.equal(inspectAcceptance(db, swarm.id).verdict, "accepted");
  maria.acceptance({ action: "challenge", revision: 4, finding: "New reproduction fails; evidence/regression.log" });
  assert.equal(inspectAcceptance(db, swarm.id).verdict, "incomplete");
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

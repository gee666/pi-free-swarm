import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Value } from "typebox/value";
import { AGENT_TOOL } from "../../src/constants.js";
import { createPost } from "../../src/broker/wall.js";
import { getPostContract } from "../../src/store/post-contracts.js";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 1_000, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };

function handlers(swarmId: number, agentName: string) {
  return createAgentToolHandlers({ getDb: () => db, swarmId, run: 1, agentName, clock });
}

test("contract tool exposes optional read and revision-checked free-text writes", () => {
  const swarm = seedSwarm(db);
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria" }, 200);
  const tool = pi.tool(AGENT_TOOL.contract);
  assert.ok(Value.Check(tool.parameters, { post_id: 1, action: "read" }));
  assert.ok(
    Value.Check(tool.parameters, { post_id: 1, action: "write", text: "An arbitrary document", expected_revision: 0 }),
  );
  assert.equal(Value.Check(tool.parameters, { post_id: 0, action: "read" }), false);
  assert.equal(Value.Check(tool.parameters, { post_id: 1, action: "delete" }), false);
  const post = createPost(db, swarm.id, "Liam", { title: "Argument validation", text: "Optional contract." }, T0);
  const maria = handlers(swarm.id, "Maria");
  assert.throws(
    () => maria.contract({ post_id: post.id, action: "write", text: "Missing revision" }),
    /expected_revision/,
  );
  assert.throws(() => maria.contract({ post_id: post.id, action: "write", expected_revision: 0 }), /requires text/);
  assert.equal(
    Value.Check(tool.parameters, { post_id: 1, action: "write", text: "Invalid revision", expected_revision: -1 }),
    false,
  );
  assert.match(tool.description, /revision/i);
  assert.doesNotMatch(tool.description, /At most 200 chars/);
  assert.ok(tool.promptSnippet);
});

test("contract handlers preserve full document text and reject stale edits with reread guidance", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Liam", { title: "Optional agreement", text: "Discuss the work." }, T0);
  const maria = handlers(swarm.id, "Maria");
  const john = handlers(swarm.id, "John");
  const absent = maria.contract({ post_id: post.id, action: "read" });
  assert.match(absent, /revision["\s:]*0/i);
  assert.equal(getPostContract(db, swarm.id, post.id), null);
  const text = `  # Free-form research agreement\n\n${"Reference evidence 😀. ".repeat(40)}\nFinal detail.  `;
  const created = maria.contract({ post_id: post.id, action: "write", text, expected_revision: 0 });
  assert.match(created, /revision["\s:]*1/i);
  assert.equal(getPostContract(db, swarm.id, post.id)?.text, text);
  const read = john.contract({ post_id: post.id, action: "read" });
  assert.ok(read.includes("Final detail."));
  assert.ok(read.includes("😀"));
  assert.throws(
    () => john.contract({ post_id: post.id, action: "write", text: "Stale replacement", expected_revision: 0 }),
    (error: unknown) =>
      error instanceof Error && /revision[^\d]*1/i.test(error.message) && /re.?read/i.test(error.message),
  );
  assert.equal(getPostContract(db, swarm.id, post.id)?.text, text);
  john.contract({ post_id: post.id, action: "write", text: "Merged document", expected_revision: 1 });
  assert.equal(getPostContract(db, swarm.id, post.id)?.revision, 2);
  assert.equal(getPostContract(db, swarm.id, post.id)?.updatedBy, "John");
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM post_subscriptions WHERE post_id = ?").get(post.id)?.n, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

test("contract handler scopes reads and writes to its own swarm", () => {
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const post = createPost(db, other.id, "Liam", { title: "Separate", text: "Unrelated." }, T0);
  const maria = handlers(swarm.id, "Maria");
  assert.throws(() => maria.contract({ post_id: post.id, action: "read" }), /not found/i);
  assert.throws(
    () => maria.contract({ post_id: post.id, action: "write", text: "Cross-swarm", expected_revision: 0 }),
    /not found/i,
  );
  assert.equal(getPostContract(db, other.id, post.id), null);
});

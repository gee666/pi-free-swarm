import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Value } from "typebox/value";
import { AGENT_TOOL } from "../../src/constants.js";
import { createPost } from "../../src/broker/wall.js";
import { listPostClaims } from "../../src/store/post-claims.js";
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

test("claim schema accepts arbitrary roles and recommends common names without enumerating scopes", () => {
  const swarm = seedSwarm(db);
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria" }, 200);
  const tool = pi.tool(AGENT_TOOL.claim);
  assert.ok(Value.Check(tool.parameters, { post_id: 1, role: "archival research" }));
  assert.ok(Value.Check(tool.parameters, { post_id: 1, role: "testing" }));
  assert.ok(Value.Check(tool.parameters, { post_id: 1, role: "tests" }));
  assert.equal(Value.Check(tool.parameters, { post_id: 0, role: "research" }), false);
  assert.equal(Value.Check(tool.parameters, { post_id: 1, role: "" }), false);
  assert.equal(Value.Check(tool.parameters, { post_id: 1 }), false);
  assert.match(tool.description, /common/i);
  assert.match(tool.description, /role/i);
  assert.ok(tool.promptSnippet);
});

test("claim handler reports the winner while preserving distinct free-text roles and retry identity", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Liam", { title: "Research", text: "Investigate sources." }, T0);
  const maria = handlers(swarm.id, "Maria");
  const john = handlers(swarm.id, "John");
  const first = maria.claim({ post_id: post.id, role: " archival research " });
  assert.match(first, /Maria/);
  assert.match(first, /archival research/);
  assert.throws(() => john.claim({ post_id: post.id, role: "archival research" }), {
    message: `Role "archival research" on post #${post.id} is already claimed by Maria.`,
  });
  const retry = maria.claim({ post_id: post.id, role: "archival research" });
  assert.match(retry, /Maria/);
  john.claim({ post_id: post.id, role: "tests" });
  maria.claim({ post_id: post.id, role: "testing" });
  assert.deepEqual(
    new Map(listPostClaims(db, swarm.id, post.id).map(({ agent, role }) => [role, agent])),
    new Map([
      ["archival research", "Maria"],
      ["tests", "John"],
      ["testing", "Maria"],
    ]),
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM post_subscriptions WHERE post_id = ?").get(post.id)?.n, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

test("post reads expose the chosen roles and owners without subscribing the reader", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Liam", { title: "Claim visibility", text: "Coordinate work." }, T0);
  const maria = handlers(swarm.id, "Maria");
  const john = handlers(swarm.id, "John");
  maria.claim({ post_id: post.id, role: "historical research" });
  const rendered = john.readPost({ post_id: post.id });
  assert.match(rendered, /Claims: "historical research": Maria/);
  assert.match(rendered, /Coordinate work/);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE post_id = ? AND name = ?").get(post.id, "John")?.n,
    1,
  );
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_subscriptions WHERE post_id = ? AND name = ?").get(post.id, "John")
      ?.n,
    0,
  );
  assert.equal(listPostClaims(db, swarm.id, post.id).length, 1);
});

test("claim handler uses its own swarm and broker validation rather than trusting caller roles", () => {
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const post = createPost(db, other.id, "Liam", { title: "Separate", text: "Unrelated work." }, T0);
  const maria = handlers(swarm.id, "Maria");
  assert.throws(() => maria.claim({ post_id: post.id, role: "research" }), /not found/i);
  const local = createPost(db, swarm.id, "Liam", { title: "Local", text: "Review." }, T0);
  assert.throws(() => maria.claim({ post_id: local.id, role: " \n " }), /role/i);
  assert.throws(() => maria.claim({ post_id: local.id, role: "research\nreview" }), /role/i);
  assert.equal(listPostClaims(db, swarm.id, local.id).length, 0);
});

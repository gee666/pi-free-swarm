import assert from "node:assert/strict";
import { after, it } from "node:test";
import { Value } from "typebox/value";
import { AGENT_TOOL, PAGE_MAX_COUNT } from "../../src/constants.js";
import { BrokerError } from "../../src/broker/errors.js";
import { TITLE_MAX } from "../../src/limits.js";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { RESUME_PARAMS, SWARM_PARAMS, swarmDescription } from "../../src/tools/main-tools.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const swarm = seedSwarm(temp.db);
const identity = { getDb: () => temp.db, swarmId: swarm.id, run: 1, agentName: "Maria" };
const tools = createAgentToolHandlers(identity);
const pi = new FakeExtensionApi();
registerAgentTools(pi, identity, 200);

it("expresses shared bounds in provider-compatible object schemas", () => {
  for (const tool of pi.tools) {
    assert.ok("type" in tool.parameters);
    assert.equal(tool.parameters.type, "object");
    assert.equal("oneOf" in tool.parameters, false);
    assert.equal("if" in tool.parameters, false);
  }
  const read = pi.tool(AGENT_TOOL.readPosts).parameters;
  for (const count of [0, -1, 1.5, PAGE_MAX_COUNT + 1]) assert.equal(Value.Check(read, { count }), false);
  assert.equal(Value.Check(read, { offset: -1 }), false);
  assert.ok(Value.Check(read, {}));
  assert.ok(Value.Check(read, { count: PAGE_MAX_COUNT, offset: 0 }));
  const post = pi.tool(AGENT_TOOL.post).parameters;
  assert.throws(() => tools.post({ title: "x".repeat(TITLE_MAX + 1), text: "body" }), /Title too long/);
  const padded = { title: ` ${"x".repeat(TITLE_MAX)} `, text: ` ${"x".repeat(400)} ` };
  assert.ok(Value.Check(post, padded));
  assert.match(tools.post(padded), /Posted/);
  assert.equal(Value.Check(post, { title: "ok", text: " " }), false);
  // The broker's existing tolerance above the stated body limit remains valid.
  assert.ok(Value.Check(post, { title: "ok", text: "x".repeat(300) }));
  assert.equal(Value.Check(pi.tool(AGENT_TOOL.message).parameters, { to: [], text: "hi" }), false);
  assert.equal(Value.Check(RESUME_PARAMS, { swarm_id: 0, message: "Feedback" }), false);
  assert.ok(Value.Check(SWARM_PARAMS, { swarm_name: "work", task_prompt: "Task", acceptance_criteria: ["Done"] }));
});

it("identifies invalid pagination and missing vote fields without unsafe write retry advice", () => {
  const fieldError = (field: string, message: RegExp) => (error: unknown) => {
    assert.ok(error instanceof BrokerError);
    assert.equal(error.field, field);
    assert.match(error.message, message);
    assert.doesNotMatch(error.message, /retry|resend/i);
    return true;
  };
  assert.throws(() => tools.readPosts({ count: 0 }), fieldError("count", /integer 1–100/));
  assert.throws(() => tools.readPosts({ offset: -1 }), fieldError("offset", /integer >= 0/));
  assert.throws(
    () => tools.acceptance({ action: "vote", reason: "Ready" }),
    fieldError("verdict", /accepted, incomplete or blocked/),
  );
  assert.throws(
    () => tools.acceptance({ action: "vote", verdict: "accepted" }),
    fieldError("reason", /nonempty explanation/),
  );
  assert.throws(() => tools.acceptance({ action: "inspect", revision: -1 }), fieldError("revision", /omit it/));
  assert.match(tools.acceptance({ action: "vote", verdict: "incomplete", reason: "Tests missing" }), /Tests missing/);
});

it("makes concrete verifiable preparation explicit without adding a voting gate", () => {
  const description = swarmDescription(process.cwd());
  assert.match(description, /most important part/);
  assert.match(description, /locations\/formats/);
  assert.match(description, /scope and independence of verification/);
  assert.match(description, /without inventing extra scope/);
  assert.match(description, /70%/);
  const criteria = SWARM_PARAMS.properties.acceptance_criteria;
  assert.ok("description" in criteria);
  assert.equal(typeof criteria.description, "string");
  assert.ok(String(criteria.description).includes("counts or coverage"));
});

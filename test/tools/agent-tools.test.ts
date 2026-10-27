import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { AGENT_TOOL, WATCHER_TOOLS, WATCHER_TOOL } from "../../src/constants.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { workFixture } from "../helpers/work-graph.js";
import { getTaskDetail, getCriterionDetail } from "../../src/broker/work-queries.js";
import { getPostPage } from "../../src/broker/post-queries.js";
import { readConversation } from "../../src/broker/messages.js";

function handlers(f: ReturnType<typeof workFixture>, name = "Ann") {
  return createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: name });
}

test("worker tool names exactly match v2; watcher receives only read tools", (t) => {
  const f = workFixture(t);
  const pi = new FakeExtensionApi();
  const identity = { getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: "Ann" };
  registerAgentTools(pi, identity);
  assert.deepEqual(pi.toolNames().sort(), Object.values(AGENT_TOOL).sort());
  const watcher = new FakeExtensionApi();
  registerAgentTools(watcher, { ...identity, agentName: "Watcher" });
  assert.deepEqual(
    watcher.toolNames().sort(),
    WATCHER_TOOLS.filter((name) => !Object.values(WATCHER_TOOL).some((value) => value === name)).sort(),
  );
  assert.ok(Value.Check(pi.tool(AGENT_TOOL.messagesSend).parameters, { to: "Ben", body: "Hi" }));
  assert.equal(Value.Check(pi.tool(AGENT_TOOL.messagesSend).parameters, { to: ["Ben"], body: "Hi" }), false);
  assert.equal(Value.Check(pi.tool(AGENT_TOOL.tasksCreate).parameters, { title: "X", body: "Y", criteria: [] }), false);
});

test("task and criterion handlers adapt snake_case, preserve identity and return revisions", (t) => {
  const f = workFixture(t);
  const run = handlers(f);
  const output = run.tasksCreate({
    title: "Implement",
    body: "Implement and verify",
    criteria: [{ criterion_id: f.criterion.id, contribution: "Implementation" }],
    claim: true,
  });
  const id = Number(/#(\d+)/.exec(output)?.[1]);
  assert.match(output, /r2 \[claimed\]/);
  assert.match(output, new RegExp(`You now vote on criteria #${f.criterion.id}`));
  assert.match(
    run.criteriaVote({
      criterion_id: f.criterion.id,
      verdict: "covered",
      reason: "Implementation and verification cover the requirement",
    }),
    /incomplete/,
  );
  const detail = getTaskDetail(f.db, f.swarmId, id);
  assert.equal(detail.owner, "Ann");
  assert.equal(detail.criteria[0]?.criterionId, f.criterion.id);
  run.tasksTransition({ id, action: "start" });
  assert.throws(() => run.tasksTransition({ id, action: "request_review" }), /evidence is required/);
  run.tasksTransition({ id, action: "request_review", evidence: "src/a.ts; tests passed" });
  assert.throws(() => run.tasksReview({ id, verdict: "accept", reason: "Good" }), /owner|own task/);
  assert.match(handlers(f, "Ben").tasksReview({ id, verdict: "accept", reason: "Independent check" }), /accepted/);
  assert.throws(() => run.tasksEdit({ id, expected_revision: 1, body: "Changed" }), /Reread/);
  const criterion = getCriterionDetail(f.db, f.swarmId, f.criterion.id);
  run.criteriaEdit({ id: criterion.id, expected_revision: criterion.revision, verification: "npm test" });
  assert.equal(getCriterionDetail(f.db, f.swarmId, criterion.id).verification, "npm test");
  assert.match(run.criteriaVoteContext({}), /Next cursor:/);
});

test("tool schemas reject identity overrides and handlers always retain context identity", (t) => {
  const f = workFixture(t);
  const run = handlers(f);
  const spoofed = {
    group: "Delivery",
    title: "Scoped",
    body: "Check scope",
    verification: "Run tests",
    source: "brief.md",
    actor: "User",
    swarmId: 999,
  };
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, { getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: "Ann" });
  assert.equal(Value.Check(pi.tool(AGENT_TOOL.criteriaCreate).parameters, spoofed), false);
  const output = run.criteriaCreate(spoofed);
  const id = Number(/#(\d+)/.exec(output)?.[1]);
  assert.equal(getCriterionDetail(f.db, f.swarmId, id).author, "Ann");
});

test("dependency follow-ups and searches show compact status lines, cursor and mode", async (t) => {
  const f = workFixture(t);
  const dependency = f.task();
  const run = handlers(f);
  const output = run.tasksCreate({
    title: "Dependent",
    body: "Wait for prerequisite",
    criteria: [{ criterion_id: f.criterion.id, contribution: "Integration" }],
    depends_on: [dependency.id],
    claim: true,
  });
  assert.match(output, new RegExp(`Waiting on #${dependency.id}`));
  assert.match(output, /you will be notified/);
  const unclaimed = f.task();
  assert.match(run.tasksClaim({ id: unclaimed.id }), new RegExp(`You now vote on criteria #${f.criterion.id}`));
  const search = await run.tasksSearch({ query: "Dependent", waiting: true, limit: 1 });
  assert.match(search, /\[claimed\] Dependent · owner Ann/);
  assert.match(search, /Next cursor:|Search: bm25/);
  assert.match(await run.criteriaSearch({ group: "Delivery" }), /\[incomplete\] Works/);
  assert.match(run.project(), /Brief:.*brief.md/);
  assert.match(run.project(), /Scope|Own tasks:|Tools:/);
});

test("post tools search comments, filter links/subscriptions and page comments", async (t) => {
  const f = workFixture(t);
  const task = f.task();
  const run = handlers(f);
  const output = run.postsCreate({
    title: "Discussion",
    body: "Design notes",
    task_ids: [task.id],
    criterion_ids: [f.criterion.id],
  });
  const id = Number(/#(\d+)/.exec(output)?.[1]);
  assert.match(output, /Subscribed to post/);
  run.postsComment({ post_id: id, body: "Distinctive comment phrase" });
  run.postsComment({ post_id: id, body: "Second comment" });
  assert.match(await run.postsSearch({ query: "Distinctive", task_id: task.id, subscribed: true }), /Discussion/);
  assert.equal(getPostPage(f.db, f.swarmId, id).links.length, 2);
  const page = run.postsGet({ id, limit: 1 });
  assert.match(page, /Distinctive/);
  assert.doesNotMatch(page, /Second comment/);
  const cursor = /Next cursor: (\S+)/.exec(page)?.[1];
  assert.match(run.postsGet({ id, limit: 1, cursor }), /Second comment/);
  run.postsUnsubscribe({ post_id: id });
  assert.doesNotMatch(await run.postsSearch({ subscribed: true }), /Discussion/);
  run.postsLink({ post_id: id, task_ids: [task.id] }, true);
  assert.equal(getPostPage(f.db, f.swarmId, id).links.length, 1);
});

test("messages continue one private conversation in both directions", (t) => {
  const f = workFixture(t);
  handlers(f).messagesSend({ to: "Ben", body: "One" });
  handlers(f, "Ben").messagesSend({ to: "Ann", body: "Two" });
  const conversation = readConversation(f.db, { swarmId: f.swarmId, a: "Ann", b: "Ben", limit: 1 });
  assert.deepEqual(conversation.thread?.members, ["Ann", "Ben"]);
  assert.equal(conversation.messages.length, 1);
  assert.ok(conversation.nextAfter);
  assert.match(handlers(f).messagesRead({ with: "Ben" }), /One.*Two/);
  assert.deepEqual(readConversation(f.db, { swarmId: f.swarmId, a: "Ann", b: "Cam" }).messages, []);
});

test("Watcher can answer User but cannot message an agent", (t) => {
  const f = workFixture(t);
  const run = handlers(f, "Watcher");
  assert.throws(() => run.messagesSend({ to: "Ann", body: "Do work" }), /only to User/);
  assert.match(run.messagesSend({ to: "user", body: "The graph is unfinished." }), /sent/);
  assert.match(run.messagesRead({ with: "User" }), /The graph is unfinished/);
});

test("fixed Unicode limits cover all agent fields, including optional fields", (t) => {
  const f = workFixture(t);
  const run = handlers(f);
  assert.doesNotThrow(() => run.postsCreate({ title: "😀".repeat(100), body: "😀".repeat(300) }));
  for (const action of [
    () => run.postsCreate({ title: "x".repeat(101), body: "ok" }),
    () => run.postsCreate({ title: "ok", body: "x".repeat(301) }),
    () => run.messagesSend({ to: "Ben", body: "x".repeat(301) }),
    () =>
      run.criteriaCreate({
        group: "Quality",
        title: "Works",
        body: "Check",
        verification: "Test",
        source: "x".repeat(301),
      }),
    () => run.intentUpdate({ summary: "x".repeat(301), path: "intent.md" }),
  ])
    assert.throws(action, /too long.*file/i);
});

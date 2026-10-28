import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { recordUsage, setAgentActivity, setAgentStatus } from "../../src/broker/agent-state.js";
import { createSwarm, endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { WATCHER_ACTIVITY_MAX, WATCHER_NAME, WATCHER_TEXT_MAX, WATCHER_TOOLS } from "../../src/constants.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { registerAgentTools } from "../../src/tools/agent-tools.js";
import { compactText } from "../../src/tools/watcher-digest.js";
import { createWatcherToolHandlers, registerWatcherTools } from "../../src/tools/watcher-tools.js";
import { createTempDb } from "../helpers/temp-db.js";
import { FakeClock } from "../agents/fake-clock.js";
import { assistantLine, errorLine, headerLine, toolCall, toolResultLine } from "../fixtures/sessions/helpers.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";

const temp = createTempDb();
const { db } = temp;
after(() => temp.cleanup());
const clock = new FakeClock(Date.parse("2026-09-24T09:00:05.000Z"));
const swarm = createSwarm(db, {
  name: "observed",
  taskPrompt: "Improve login.",
  acceptanceCriteria: ["Login improvements pass the checks."],
  agentNames: ["Maria", "John"],
  runnerPid: process.pid,
  now: clock.now(),
});
const identity = { getDb: () => db, swarmId: swarm.id, run: 1, agentName: WATCHER_NAME, clock };
const run = createWatcherToolHandlers(identity);
const maria = listAgentSessions(db, swarm.id).find((agent) => agent.name === "Maria");
assert.ok(maria);
mkdirSync(path.dirname(maria.sessionFile), { recursive: true });
writeFileSync(
  maria.sessionFile,
  headerLine() +
    assistantLine("a1", [{ type: "text", text: "I am developing token rotation." }]) +
    assistantLine("a2", [toolCall("call1", "read", { path: "src/login.ts" })]) +
    toolResultLine("r2", "call1", "SECRET OUTPUT MUST NOT APPEAR", undefined, true) +
    errorLine("e3", "provider failed") +
    assistantLine("a4", [{ type: "text", text: "Newest plan\n" + "x".repeat(WATCHER_TEXT_MAX * 2) }]),
);

it("formats newest-first activity, trims texts, includes errors and never includes tool outputs", async () => {
  const digest = await run.activity({ agent: "maria" });
  assert.ok(digest.indexOf("Newest plan") < digest.indexOf("provider failed"));
  assert.ok(digest.indexOf("provider failed") < digest.indexOf("ERROR tool: read src/login.ts"));
  assert.match(digest, /token rotation/);
  assert.doesNotMatch(digest, /SECRET OUTPUT/);
  assert.equal(compactText("x".repeat(WATCHER_TEXT_MAX * 2)).length, WATCHER_TEXT_MAX);
  assert.equal(compactText(" a\n b "), "a b");
});

it("pages activity without duplicates and validates cursors and sizes", async () => {
  const first = await run.activity({ agent: "Maria", count: 1 });
  const cursor = /Next cursor: (\d+)/.exec(first)?.[1];
  assert.ok(cursor);
  const second = await run.activity({ agent: "Maria", count: 1, before: cursor });
  assert.match(second, /provider failed/);
  assert.doesNotMatch(second, /Newest plan/);
  await assert.rejects(run.activity({ agent: "Maria", before: "bad" }), /Invalid before/);
  await assert.rejects(run.activity({ agent: "Maria", count: 0 }), /count must/);
  await assert.rejects(run.activity({ agent: "missing" }), /not found/);
  assert.match(await run.activity({ agent: WATCHER_NAME }), /No assistant activity/);
});

it("summarizes state, last activity, usage, tool, text, goal, acceptance and newest titles", async () => {
  setAgentStatus(db, swarm.id, "Maria", "working", clock.now());
  recordUsage(
    db,
    swarm.id,
    "Maria",
    {
      kind: "message",
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.25,
      model: "test",
    },
    clock.now(),
  );
  createPost(db, swarm.id, "John", { title: "Rotation idea", text: "Use short-lived tokens." }, clock.now());
  const overview = await run.overview();
  assert.match(overview, /Maria: busy; activity 5s ago; turns 1; cost \$0.2500/);
  assert.match(overview, /read src\/login.ts/);
  assert.match(overview, /Newest plan/);
  assert.match(overview, /Goal: Improve login/);
  assert.match(overview, /outcome unfinished; wall posts 1/);
  assert.match(overview, /Rotation idea/);
  assert.doesNotMatch(overview, /SECRET OUTPUT/);
});

it("does not hunt backwards for assistant text outside the recent slice", async () => {
  for (let index = 0; index <= WATCHER_ACTIVITY_MAX; index++) {
    appendFileSync(
      maria.sessionFile,
      assistantLine(`tail-${index}`, [toolCall(`tail-call-${index}`, "read", { path: "src/tail.ts" })]),
    );
  }
  const overview = await run.overview();
  assert.doesNotMatch(overview, /Newest plan/);
  assert.match(overview, /assistant: not in inspected slice/);
  assert.match(overview, /older history omitted/);
  assert.match(overview, /read src\/tail.ts/);
  assert.match(
    await run.activity({
      agent: "Maria",
      before: /Next cursor: (\d+)/.exec(await run.activity({ agent: "Maria", count: WATCHER_ACTIVITY_MAX }))?.[1],
    }),
    /Newest plan/,
  );
});

it("shows the actual runtime tool separately from a different historical tool", async () => {
  setAgentActivity(db, swarm.id, "Maria", { kind: "tool", toolName: "bash" }, clock.now());
  const overview = await run.overview();
  assert.match(overview, /current tool: bash/);
  assert.match(overview, /recent tool: read src\/tail.ts/);
});

it("retains retired status and deliberate historical session inspection after the run stops", async () => {
  db.sql
    .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?")
    .run(clock.now(), swarm.id, "Maria");
  const retiredBlock = (await run.overview()).split("\n\n").find((block) => block.startsWith("Maria: retired"));
  assert.match(retiredBlock ?? "", /current tool: none/);
  assert.match(retiredBlock ?? "", /Recent slice: 0 entries, 0 bytes/);
  assert.match(await run.activity({ agent: "Maria", count: 1 }), /read src\/tail.ts/);
  assert.equal(endRun(db, swarm.id, process.pid, "stopped", clock.now()), true);
  assert.match(await run.overview(), /Maria: retired/);
  assert.match(await run.activity({ agent: "Maria", count: 1 }), /read src\/tail.ts/);
});

it("registers exactly the Watcher allowlist, without acceptance or built-in tools", () => {
  const pi = new FakeExtensionApi();
  registerAgentTools(pi, identity);
  registerWatcherTools(pi, identity);
  assert.deepEqual(pi.toolNames(), WATCHER_TOOLS);
});

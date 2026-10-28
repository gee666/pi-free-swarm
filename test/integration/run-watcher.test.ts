import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, it } from "node:test";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { getPostPage } from "../../src/broker/post-queries.js";
import { createPost } from "../../src/broker/wall.js";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { SYSTEM_PROMPT_FILE, WATCHER_NAME, WATCHER_TOOLS } from "../../src/constants.js";
import { agentSessionFile } from "../../src/store/db.js";
import { getStats } from "../../src/store/stats-queries.js";
import {
  agentStatus,
  finishWork,
  waitForWorkersIdle,
  createRunFixture,
  newestSwarmId,
  recipientStatus,
  reviveCount,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

it("launches Watcher idle without kickoff, uses the tool allowlist, and stops it without waiting for its turn", async () => {
  const run = createRunFixture({
    runs: [[{ type: "tool", ms: 500 }, { type: "reply" }]],
    agents: { [WATCHER_NAME]: { runs: [[{ type: "tool", ms: 5000 }]] } },
  });
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "watched", taskPrompt: "WORKER TASK ONLY", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
    {},
  );
  const swarmId = newestSwarmId(run.db);
  await waitFor(() => agentStatus(run.db, swarmId, WATCHER_NAME) === "idle", "Watcher idle");
  assert.equal(run.fake.log().filter((record) => record.agent === WATCHER_NAME && record.type === "prompt").length, 0);
  const spawn = run.fake.log().find((record) => record.agent === WATCHER_NAME && record.fake === "spawn");
  const argv = Array.isArray(spawn?.argv) ? spawn.argv.map(String) : [];
  assert.equal(argv[argv.indexOf("--tools") + 1], WATCHER_TOOLS.join(","));
  assert.ok(!WATCHER_TOOLS.some((name) => ["bash", "edit", "write", "swarm_acceptance"].includes(name)));
  const promptPath = path.join(
    path.dirname(agentSessionFile(run.db.dataDir, swarmId, WATCHER_NAME)),
    SYSTEM_PROMPT_FILE,
  );
  assert.match(readFileSync(promptPath, "utf8"), /Do not do or verify the work/);
  const post = createPost(
    run.db,
    swarmId,
    "User",
    { title: "Question", text: "@Watcher What are they doing?" },
    Date.now(),
  );
  const questionId = Number(
    run.db.sql
      .prepare(
        "SELECT message_id FROM message_recipients WHERE swarm_id = ? AND name = ? ORDER BY message_id DESC LIMIT 1",
      )
      .get(swarmId, WATCHER_NAME)?.message_id,
  );
  await waitFor(() => recipientStatus(run.db, questionId, WATCHER_NAME) === "read", "Watcher read question");
  const prompt = run.fake.log().find((record) => record.agent === WATCHER_NAME && record.type === "prompt");
  assert.match(String(prompt?.message), /What are they doing/);
  assert.ok(String(prompt?.message).includes(`post #${post.id}`));
  assert.match(readFileSync(promptPath, "utf8"), /answer by commenting on the same post with swarm_posts_comment/);
  assert.doesNotMatch(String(prompt?.message), /WORKER TASK ONLY|Task for the swarm/);
  const tools = createAgentToolHandlers({ getDb: () => run.db, swarmId, run: 1, agentName: WATCHER_NAME });
  assert.ok(tools.postsGet({ id: post.id }).includes("What are they doing?"));
  assert.match(
    tools.postsComment({ post_id: post.id, body: "The workers are checking the recorded requirements." }),
    /You are subscribed/,
  );
  assert.equal(getPostPage(run.db, swarmId, post.id).comments[0]?.author, WATCHER_NAME);
  await waitForWorkersIdle(run, swarmId);
  finishWork(run.db, swarmId);
  assert.equal((await outcome).end, "finished");
  assert.equal(agentStatus(run.db, swarmId, WATCHER_NAME), "stopped");
  assert.equal(reviveCount(run.db, swarmId, WATCHER_NAME), 0);
  assert.equal(getStats(run.db, swarmId, Date.now())?.agents.find((agent) => agent.name === WATCHER_NAME)?.turns, 1);
});

it("does not revive Watcher crashes or let them block worker completion", async () => {
  const run = createRunFixture({
    runs: [[{ type: "reply" }]],
    agents: { [WATCHER_NAME]: { startup: [{ type: "exit", code: 3 }] } },
  });
  fixture = run;
  const outcome = startSwarm(
    run.env,
    { name: "crashed watcher", taskPrompt: "Work.", acceptanceCriteria: ["Work is complete."], agentAmount: 1 },
    {},
  );
  const swarmId = newestSwarmId(run.db);
  await waitForWorkersIdle(run, swarmId);
  await waitFor(() => agentStatus(run.db, swarmId, WATCHER_NAME) === "crashed", "Watcher crashed");
  finishWork(run.db, swarmId);
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.equal(agentStatus(run.db, result.swarm.id, WATCHER_NAME), "crashed");
  assert.equal(reviveCount(run.db, result.swarm.id, WATCHER_NAME), 0);
  assert.equal(run.fake.log().filter((record) => record.agent === WATCHER_NAME && record.fake === "spawn").length, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { SYSTEM_PROMPT_FILE, WATCHER_NAME, WATCHER_TOOLS } from "../../src/constants.js";
import { agentSessionFile } from "../../src/store/db.js";
import { getStats } from "../../src/store/stats-queries.js";
import {
  agentStatus,
  voteAll,
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
  const question = sendMessage(run.db, swarmId, "User", [WATCHER_NAME], "What are they doing?", Date.now());
  await waitFor(() => recipientStatus(run.db, question.id, WATCHER_NAME) === "read", "Watcher read question");
  const prompt = run.fake.log().find((record) => record.agent === WATCHER_NAME && record.type === "prompt");
  assert.match(String(prompt?.message), /What are they doing/);
  assert.doesNotMatch(String(prompt?.message), /WORKER TASK ONLY|Task for the swarm/);
  await waitForWorkersIdle(run, swarmId);
  voteAll(run.db, swarmId, "accepted", "Worker completed the task while Watcher was busy.");
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
  voteAll(run.db, swarmId, "accepted", "Worker verified the task despite Watcher failure.");
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.equal(agentStatus(run.db, result.swarm.id, WATCHER_NAME), "crashed");
  assert.equal(reviveCount(run.db, result.swarm.id, WATCHER_NAME), 0);
  assert.equal(run.fake.log().filter((record) => record.agent === WATCHER_NAME && record.fake === "spawn").length, 1);
});

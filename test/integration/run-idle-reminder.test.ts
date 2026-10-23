import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { resumeSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createPost } from "../../src/broker/wall.js";
import { IDLE_REMINDER_HEADER } from "../../src/constants.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

function vote(run: RunFixture, id: number, agent: string, verdict: "accepted" | "blocked" | "incomplete") {
  mutateAcceptance(run.db, id, agent, { action: "vote", verdict, reason: `Work is ${verdict}.` }, Date.now());
}

const task = { name: "keep going", taskPrompt: "Work.", acceptanceCriteria: ["The work is done."], agentAmount: 1 };
const reminderCount = (run: RunFixture) =>
  promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER)).length;

it("idle agents are repeatedly woken until a terminal vote, without a reminder cap", { timeout: 15_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle, {
    reminders: { idleReminderDelay: 100, idleReminderDigestSize: 1 },
  });
  fixture = run;
  let finished = false;
  const outcome = startSwarm(run.env, task, {}).then((result) => {
    finished = true;
    return result;
  });
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
  vote(run, id, name, "incomplete");
  createPost(run.db, id, "User", { title: "Latest gap", text: "Verify output." }, Date.now());
  await waitFor(() => reminderCount(run) >= 6, "six reminders without closure");
  assert.equal(finished, false);
  assert.equal(getSwarm(run.db, id, Date.now())?.status, "running");
  const reminders = promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER));
  assert.ok(reminders.some((text) => text.includes("Latest gap")));
  assert.ok(
    reminders.every((text) => text.includes("Quorum: 1/1 for the same accepted or blocked verdict.")),
    "every reminder retains the current whole-task quorum tally",
  );
  for (const table of ["messages", "threads"]) {
    assert.equal(run.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  }
  vote(run, id, name, "accepted");
  const result = await outcome;
  assert.equal(result.end, "finished");
  assert.equal(result.acceptance.verdict, "accepted");
});

for (const verdict of ["accepted", "blocked"] as const) {
  it(`${verdict} quorum closes without waiting for the idle reminder`, { timeout: 10_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle, {
      reminders: { idleReminderDelay: 60_000, idleReminderDigestSize: 10 },
    });
    fixture = run;
    const outcome = startSwarm(run.env, { ...task, name: verdict }, {});
    const id = newestSwarmId(run.db);
    const [name] = agentNames(run.db, id);
    await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
    vote(run, id, name, verdict);
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.acceptance.verdict, verdict);
    assert.equal(reminderCount(run), 0);
  });
}

it("resume clears old votes and wakes idle agents again", { timeout: 15_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle, {
    reminders: { idleReminderDelay: 100, idleReminderDigestSize: 1 },
  });
  fixture = run;
  const first = startSwarm(run.env, task, {});
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
  vote(run, id, name, "accepted");
  await first;
  const before = reminderCount(run);
  const second = resumeSwarm(run.env, { swarmId: id, message: "Continue." }, {});
  assert.equal(inspectAcceptance(run.db, id).votes.length, 0);
  await waitFor(() => reminderCount(run) > before, "resumed reminder");
  assert.equal(getSwarm(run.db, id, Date.now())?.status, "running");
  vote(run, id, name, "blocked");
  const result = await second;
  assert.equal(result.run, 2);
  assert.equal(result.acceptance.verdict, "blocked");
});

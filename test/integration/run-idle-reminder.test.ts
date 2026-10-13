import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { resumeSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createPost } from "../../src/broker/wall.js";
import { IDLE_REMINDER_HEADER } from "../../src/constants.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { buildRunResultText } from "../../src/tools/result.js";
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

function judgment(run: RunFixture, id: number, agent: string, verdict: "accepted" | "blocked" | "incomplete") {
  const revision = inspectAcceptance(run.db, id).revision;
  mutateAcceptance(run.db, id, agent, { action: "claim", revision }, Date.now());
  mutateAcceptance(
    run.db,
    id,
    agent,
    {
      action: "update",
      revision: revision + 1,
      verdict,
      payload: {
        evidence: [{ reference: "checks.log", result: verdict }],
        knownGaps: verdict === "accepted" ? [] : ["Input missing"],
        findings: verdict === "accepted" ? [] : ["Supply input"],
      },
    },
    Date.now(),
  );
}

it(
  "idle alone does not finish; reminders wake through the prompt path and budget exhaustion still needs grace",
  { timeout: 15_000 },
  async () => {
    const delay = 600;
    const grace = 200;
    const run = createRunFixture(SCENARIOS.settle, {
      reminders: { idleReminderDelay: delay, idleReminderMax: 2, idleReminderDigestSize: 1 },
      timings: { completionGraceMs: grace },
    });
    fixture = run;
    let finished = false;
    const outcome = startSwarm(
      run.env,
      { name: "keep going", taskPrompt: "Work.", agentAmount: 1 },
      {
        onProgress: (progress) => run.progress.push(progress),
      },
    ).then((result) => {
      finished = true;
      return result;
    });
    const id = newestSwarmId(run.db);
    const [name] = agentNames(run.db, id);
    await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
    judgment(run, id, name, "incomplete");
    createPost(run.db, id, "User", { title: "Latest gap", text: "Verify output." }, Date.now());
    const idleAt = Date.now();
    await waitFor(() => Date.now() - idleAt > grace + 50 && run.progress.length > 0, "past completion grace");
    assert.equal(finished, false, "a pending reminder keeps a quiet swarm running");
    assert.equal(getSwarm(run.db, id, Date.now())?.status, "running");
    assert.equal(promptTexts(run.fake).length, 1);
    await waitFor(
      () => promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER)).length === 2,
      "both reminders",
    );
    await waitFor(() => agentStatus(run.db, id, name) === "idle", "idle after final reminder");
    const finalIdleAt = Number(
      run.db.sql.prepare("SELECT MAX(ended_at) AS ended_at FROM agent_runs WHERE swarm_id = ?").get(id)?.ended_at,
    );
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.acceptance.verdict, "incomplete");
    assert.ok((result.swarm.finishedAt ?? 0) - finalIdleAt >= grace);
    const reminders = promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER));
    assert.equal(reminders.length, 2);
    assert.match(reminders[0], /User · .* ago · Latest gap — Verify output/);
    for (const table of ["messages", "threads"]) {
      assert.equal(run.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    }
    const text = buildRunResultText(run.db, result, null, Date.now());
    assert.match(text, /finished execution \(quiescent; not a task-success verdict\)/);
    assert.match(text, /Task verdict: incomplete/);
    assert.match(text, /Task completion is not accepted/);
  },
);

for (const verdict of ["accepted", "blocked"] as const) {
  it(
    `a quiet ${verdict} swarm completes after grace without waiting for its reminder`,
    { timeout: 10_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle, {
        reminders: { idleReminderDelay: 60_000, idleReminderMax: 5, idleReminderDigestSize: 10 },
      });
      fixture = run;
      const outcome = startSwarm(run.env, { name: verdict, taskPrompt: "Work.", agentAmount: 1 }, {});
      const id = newestSwarmId(run.db);
      const [name] = agentNames(run.db, id);
      await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
      judgment(run, id, name, verdict);
      const result = await outcome;
      assert.equal(result.end, "finished");
      assert.equal(result.acceptance.verdict, verdict);
      assert.equal(promptTexts(run.fake).length, 1);
    },
  );
}

it("resume starts a new reminder budget", { timeout: 15_000 }, async () => {
  const run = createRunFixture(SCENARIOS.settle, {
    reminders: { idleReminderDelay: 100, idleReminderMax: 1, idleReminderDigestSize: 1 },
    timings: { completionGraceMs: 200 },
  });
  fixture = run;
  const first = startSwarm(run.env, { name: "again", taskPrompt: "Work.", agentAmount: 1 }, {});
  const id = newestSwarmId(run.db);
  const [name] = agentNames(run.db, id);
  await waitFor(() => agentStatus(run.db, id, name) === "idle", "initial idle");
  judgment(run, id, name, "incomplete");
  await first;
  const before = promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER)).length;
  assert.equal(before, 1);
  const second = resumeSwarm(run.env, { swarmId: id, message: "Continue." }, {});
  await waitFor(() => agentStatus(run.db, id, name) === "idle", "resumed idle");
  judgment(run, id, name, "incomplete");
  assert.equal((await second).run, 2);
  assert.equal(promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER)).length, before + 1);
});

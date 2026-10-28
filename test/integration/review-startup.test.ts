import assert from "node:assert/strict";
import { test } from "node:test";
import { startSwarm, resumeSwarm } from "../../src/broker/run-entry.js";
import { getTask, listTasks, taskTimeline } from "../../src/store/tasks.js";
import { agentNames, createRunFixture, newestSwarmId, waitForWorkersIdle } from "./run-fixture.js";

test("starting a resumed run returns a task abandoned in review to in_progress", { timeout: 15000 }, async () => {
  const f = createRunFixture({});
  const firstAbort = new AbortController();
  const first = startSwarm(
    f.env,
    { name: "Review recovery", taskPrompt: "Build feature", acceptanceCriteria: ["Works"], agentAmount: 1 },
    { signal: firstAbort.signal },
  );
  let second: ReturnType<typeof resumeSwarm> | undefined;
  const secondAbort = new AbortController();
  try {
    const swarmId = newestSwarmId(f.db);
    await waitForWorkersIdle(f, swarmId);
    firstAbort.abort();
    await first;
    const task = listTasks(f.db, swarmId)[0];
    const owner = agentNames(f.db, swarmId)[0];
    assert.ok(task && owner);
    f.db.sql.prepare("UPDATE tasks SET status = 'review', owner = ? WHERE id = ?").run(owner, task.id);
    second = resumeSwarm(f.env, { swarmId, message: "Continue work" }, { signal: secondAbort.signal });
    await waitForWorkersIdle(f, swarmId);
    assert.equal(getTask(f.db, swarmId, task.id)?.status, "in_progress");
    assert.match(taskTimeline(f.db, task.id).at(-1)?.body ?? "", /no live reviewer/);
    secondAbort.abort();
    await second;
  } finally {
    firstAbort.abort();
    secondAbort.abort();
    await first;
    await second;
    f.cleanup();
  }
});

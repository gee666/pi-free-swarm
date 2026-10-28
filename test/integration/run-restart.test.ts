import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { readProject } from "../../src/broker/project.js";
import { restartSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { endRun } from "../../src/broker/swarms.js";
import { RESTART_PROMPT_HEADER, RESUME_PROMPT_HEADER, WATCHER_NAME } from "../../src/constants.js";
import { appendConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { listCriteria } from "../../src/store/criteria.js";
import { getSwarm, listAgentSessions } from "../../src/store/swarm-queries.js";
import { listTasks } from "../../src/store/tasks.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  createRunFixture,
  finishWork,
  newestSwarmId,
  promptTexts,
  spawnsOf,
  waitFor,
  waitForWorkersIdle,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

function start(run: RunFixture, signal?: AbortSignal) {
  return startSwarm(
    run.env,
    {
      name: "restart",
      taskPrompt: "Build it.",
      acceptanceCriteria: ["Work is complete."],
      agentAmount: 2,
    },
    { signal },
  );
}

for (const status of ["stopped", "interrupted"] as const) {
  test(
    `restart relaunches a ${status} swarm's non-retired agents with their sessions and unchanged work`,
    { timeout: 30_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle);
      fixture = run;
      const abort = new AbortController();
      const pending = start(run, abort.signal);
      const swarmId = newestSwarmId(run.db);
      await waitForWorkersIdle(run, swarmId);
      if (status === "stopped") abort.abort();
      else endRun(run.db, swarmId, process.pid, "interrupted", Date.now(), 1);
      assert.equal((await pending).end, status);

      const [retired] = listAgentSessions(run.db, swarmId).filter(({ name }) => name !== WATCHER_NAME);
      assert.ok(retired);
      run.db.sql
        .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?")
        .run(Date.now(), swarmId, retired.name);
      const saved = getRunConfiguration(run.db, swarmId, 1);
      assert.ok(saved);
      appendConfigurationRevision(
        run.db,
        swarmId,
        1,
        {
          ...saved.effective,
          workers: saved.effective.workers.filter(({ name }) => name !== retired.name),
        },
        saved.revision ?? 0,
        Date.now(),
      );
      const sessions = listAgentSessions(run.db, swarmId, { activeOnly: true })
        .filter(({ name }) => name !== WATCHER_NAME)
        .map(({ sessionFile }) => sessionFile);
      const project = readProject(run.db, swarmId);
      assert.ok(project.briefPath);
      const briefPath = path.join(run.cwd, project.briefPath);
      const brief = readFileSync(briefPath, "utf8");
      const tasks = listTasks(run.db, swarmId);
      const criteria = listCriteria(run.db, swarmId);
      const before = spawnsOf(run.fake).length;
      const restarted = restartSwarm(run.env, { swarmId }, {});
      await waitFor(() => spawnsOf(run.fake).length === before + sessions.length, "restarted workers spawned");
      await waitFor(
        () =>
          run.db.sql
            .prepare(
              "SELECT count(*) AS n FROM participants WHERE swarm_id = ? AND kind = 'agent' AND name <> ? AND retired_at IS NULL AND status <> 'idle'",
            )
            .get(swarmId, WATCHER_NAME)?.n === 0,
        "restarted workers idle",
      );
      assert.deepEqual(
        spawnsOf(run.fake)
          .slice(before)
          .map(({ session }) => session),
        sessions,
      );
      assert.deepEqual(listTasks(run.db, swarmId), tasks);
      assert.deepEqual(listCriteria(run.db, swarmId), criteria);
      assert.deepEqual(readProject(run.db, swarmId), project);
      assert.equal(readFileSync(briefPath, "utf8"), brief);
      assert.equal(
        run.db.sql.prepare("SELECT count(*) AS n FROM messages WHERE swarm_id = ? AND sender = 'Main'").get(swarmId)?.n,
        0,
      );
      const prompts = promptTexts(run.fake).filter((text) => text.startsWith(RESTART_PROMPT_HEADER));
      assert.equal(prompts.length, sessions.length);
      for (const prompt of prompts) {
        assert.match(
          prompt,
          /Your process was stopped by an interruption and restarted; files and the work graph remain\./,
        );
        assert.match(prompt, /do not replay writes whose effects are uncertain/);
        assert.doesNotMatch(prompt, /Update for run|Main-authored update task/);
      }
      assert.ok(promptTexts(run.fake).every((text) => !text.startsWith(RESUME_PROMPT_HEADER)));
      assert.equal(getSwarm(run.db, swarmId, Date.now())?.runCount, 2);
      finishWork(run.db, swarmId);
      assert.equal((await restarted).end, "finished");
    },
  );
}

for (const outcome of ["completed", "stopped_with_blockers"] as const) {
  test(`restart refuses a swarm finished with outcome ${outcome}`, { timeout: 30_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const pending = start(run);
    const swarmId = newestSwarmId(run.db);
    await waitForWorkersIdle(run, swarmId);
    finishWork(run.db, swarmId);
    assert.equal((await pending).end, "finished");
    run.db.sql.prepare("UPDATE swarms SET outcome = ? WHERE id = ?").run(outcome, swarmId);
    const tasks = listTasks(run.db, swarmId);
    await assert.rejects(
      restartSwarm(run.env, { swarmId }, {}),
      /finished with an outcome\. Use resume_swarm with an update/,
    );
    assert.deepEqual(listTasks(run.db, swarmId), tasks);
    assert.equal(getSwarm(run.db, swarmId, Date.now())?.runCount, 1);
    assert.equal(spawnsOf(run.fake).length, 2);
  });
}

test(
  "restart attaches to an active local run and waits without changing its brief or work",
  { timeout: 30_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const pending = start(run);
    const swarmId = newestSwarmId(run.db);
    await waitForWorkersIdle(run, swarmId);
    const tasks = listTasks(run.db, swarmId);
    const project = readProject(run.db, swarmId);
    let updates = 0;
    let ended = false;
    const attached = restartSwarm(run.env, { swarmId }, { onProgress: () => updates++ });
    void attached.then(() => {
      ended = true;
    });
    await waitFor(() => updates > 0, "attached progress");
    assert.equal(ended, false);
    assert.deepEqual(listTasks(run.db, swarmId), tasks);
    assert.deepEqual(readProject(run.db, swarmId), project);
    assert.equal(spawnsOf(run.fake).length, 2);
    finishWork(run.db, swarmId);
    const results = await Promise.all([pending, attached]);
    assert.ok(results.every((result) => result.end === "finished" && result.run === 1));
    assert.equal(spawnsOf(run.fake).length, 2);
  },
);

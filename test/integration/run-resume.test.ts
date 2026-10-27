import assert from "node:assert/strict";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { listTasks, taskLinks } from "../../src/store/tasks.js";
import { readProject } from "../../src/broker/project.js";
import { listCriteria } from "../../src/store/criteria.js";
import { getMessages } from "../../src/store/message-queries.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import { BrokerError } from "../../src/broker/errors.js";
import { createSwarm, markSwarmRunning } from "../../src/broker/swarms.js";
import { resumeSwarm, startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { MAIN_FEEDBACK_POST_SUFFIX, MAIN_FEEDBACK_POST_TITLE, RESUME_PROMPT_HEADER } from "../../src/constants.js";
import { charCount, WORK_TEXT_ACCEPTED } from "../../src/limits.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { listPosts } from "../../src/store/wall-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  createRunFixture,
  newestSwarmId,
  promptTexts,
  spawnsOf,
  waitForWorkersIdle,
  finishWork,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

const FEEDBACK = `The login form is still broken. ${"Fix the validation and add tests. ".repeat(10)}`;

function mainMessages(run: RunFixture, swarmId: number): { id: number; body: string }[] {
  return run.db.sql
    .prepare("SELECT id, body FROM messages WHERE swarm_id = ? AND sender = 'Main' ORDER BY id")
    .all(swarmId)
    .map((row) => ({ id: Number(row.id), body: String(row.body) }));
}

describe("resume_swarm", () => {
  it(
    "relaunches every agent on its session with Main's feedback and blocks until finished",
    { timeout: 30_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle);
      fixture = run;
      const { db } = run;
      const firstRun = startSwarm(
        run.env,
        { name: "resume", taskPrompt: "Build it.", acceptanceCriteria: ["Work is complete."], agentAmount: 2 },
        {},
      );
      const swarmId = newestSwarmId(db);
      await waitForWorkersIdle(run, swarmId);
      finishWork(db, swarmId);
      const first = await firstRun;
      assert.equal(first.end, "finished");
      const sessions = spawnsOf(run.fake).map((spawn) => spawn.session);

      const secondRun = resumeSwarm(run.env, { swarmId, message: FEEDBACK }, {});
      const updateTask = listTasks(db, swarmId).find(
        (task) => task.title === "Derive criteria from the update for run 2",
      );
      assert.ok(updateTask);
      assert.equal(updateTask.author, "Main");
      assert.equal(updateTask.status, "new");
      const planning = listCriteria(db, swarmId).find((criterion) => criterion.group === "Planning");
      assert.ok(planning);
      assert.deepEqual(taskLinks(db, updateTask.id), [
        { criterionId: planning.id, contribution: "Update the criteria and tasks for the new request" },
      ]);
      const briefPath = readProject(db, swarmId).briefPath;
      assert.ok(briefPath);
      assert.ok(readFileSync(path.join(run.cwd, briefPath), "utf8").endsWith(`## Update for run 2\n\n${FEEDBACK}\n`));
      assert.equal(evaluateCompletion(db, swarmId).done, false);
      assert.ok(evaluateCompletion(db, swarmId).gates.some((gate) => gate.key === "tasks" && !gate.ok));
      await waitForWorkersIdle(run, swarmId);
      assert.equal(getSwarm(db, swarmId, Date.now())?.status, "running");
      finishWork(db, swarmId);
      const second = await secondRun;
      assert.equal(second.end, "finished");
      assert.equal(second.run, 2);
      assert.equal(second.swarm.runCount, 2);

      const [feedback] = mainMessages(run, swarmId);
      assert.ok(feedback.body.startsWith(`${FEEDBACK.trim()}\n\n`));
      assert.match(feedback.body, /brief file .* has a new section "Update for run 2"/);
      assert.match(feedback.body, /derive criteria and tasks/);
      for (const message of mainMessages(run, swarmId))
        assert.ok(getMessages(db, [message.id])[0]?.recipients.every((recipient) => recipient.status === "read"));
      const [post] = listPosts(db, swarmId, { count: 10, offset: 0 }).posts;
      assert.equal(post.author, "Main");
      assert.equal(post.title, MAIN_FEEDBACK_POST_TITLE);
      assert.ok(post.text.endsWith(` ${MAIN_FEEDBACK_POST_SUFFIX}`));
      assert.ok(charCount(post.text) <= WORK_TEXT_ACCEPTED);

      const resumed = spawnsOf(run.fake).slice(2);
      assert.deepEqual(resumed.map((spawn) => spawn.session).sort(), [...sessions].sort(), "same session files");
      const resumePrompts = promptTexts(run.fake).filter((text) => text.startsWith(RESUME_PROMPT_HEADER));
      assert.equal(resumePrompts.length, 2);
      for (const text of resumePrompts)
        assert.ok(mainMessages(run, swarmId).some((message) => text.includes(`[swarm message #${message.id}]`)));
    },
  );

  it("is rejected while another live process holds a fresh lock", async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      const holderPid = holder.pid ?? 0;
      const swarm = createSwarm(run.db, {
        name: "busy",
        taskPrompt: "Work.",
        acceptanceCriteria: ["Work is complete."],
        agentNames: ["Maria"],
        runnerPid: holderPid,
        now: Date.now(),
      });
      await assert.rejects(
        resumeSwarm(run.env, { swarmId: swarm.id, message: "more" }, {}),
        (error: unknown) =>
          error instanceof BrokerError &&
          error.code === "swarm_running" &&
          error.message === `Swarm #${swarm.id} is running in another pi process (pid ${holderPid}).`,
      );
      assert.equal(getSwarm(run.db, swarm.id, Date.now())?.runCount, 1);
      assert.deepEqual(mainMessages(run, swarm.id), [], "nothing was written");
    } finally {
      holder.kill("SIGKILL");
    }
  });

  it("takes over a 'running' swarm whose runner is gone", { timeout: 30_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle);
    fixture = run;
    const { db } = run;
    const gone = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(gone, "exit");
    const deadPid = gone.pid ?? 0;
    const now = Date.now();
    const swarm = createSwarm(db, {
      name: "stale",
      taskPrompt: "Work.",
      acceptanceCriteria: ["Work is complete."],
      agentNames: ["Maria", "John"],
      runnerPid: deadPid,
      now,
    });
    markSwarmRunning(db, swarm.id, deadPid, now);

    const outcome = resumeSwarm(run.env, { swarmId: swarm.id, message: "Carry on." }, {});
    assert.equal(newestSwarmId(db), swarm.id);
    await waitForWorkersIdle(run, swarm.id);
    finishWork(db, swarm.id);
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.run, 2);
    const runs = db.sql
      .prepare("SELECT run, end_status FROM swarm_runs WHERE swarm_id = ? ORDER BY run")
      .all(swarm.id)
      .map((row) => [Number(row.run), String(row.end_status)]);
    assert.deepEqual(runs, [
      [1, "interrupted"],
      [2, "finished"],
    ]);
    // Never persisted a session: they start with the kickoff, the feedback among their messages.
    const kickoffs = promptTexts(run.fake).filter((text) => text.startsWith("Start: call swarm_project."));
    assert.equal(kickoffs.length, 2);
    for (const text of kickoffs) {
      assert.ok(text.includes("Carry on."));
      assert.match(text, /derive criteria and tasks/);
    }
  });
});

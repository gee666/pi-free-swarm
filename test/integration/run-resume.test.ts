import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import { BrokerError } from "../../src/broker/errors.js";
import { createSwarm, markSwarmRunning } from "../../src/broker/swarms.js";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { MAIN_FEEDBACK_POST_SUFFIX, MAIN_FEEDBACK_POST_TITLE, RESUME_PROMPT_HEADER } from "../../src/constants.js";
import { charCount, TEXT_MAX } from "../../src/limits.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { listPosts } from "../../src/store/wall-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  recipientStatus,
  spawnsOf,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());

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
      const first = await startSwarm(run.env, { name: "resume", taskPrompt: "Build it.", agentAmount: 2 }, {});
      assert.equal(first.end, "finished");
      const swarmId = first.swarm.id;
      const names = agentNames(db, swarmId);
      const sessions = spawnsOf(run.fake).map((spawn) => spawn.session);

      const second = await resumeSwarm(run.env, { swarmId, message: FEEDBACK }, {});
      assert.equal(second.end, "finished");
      assert.equal(second.run, 2);
      assert.equal(second.swarm.runCount, 2);

      const [feedback] = mainMessages(run, swarmId);
      assert.equal(feedback.body, FEEDBACK.trim());
      for (const name of names) assert.equal(recipientStatus(db, feedback.id, name), "read");
      const [post] = listPosts(db, swarmId, { count: 10, offset: 0 }).posts;
      assert.equal(post.author, "Main");
      assert.equal(post.title, MAIN_FEEDBACK_POST_TITLE);
      assert.ok(post.text.endsWith(` ${MAIN_FEEDBACK_POST_SUFFIX}`));
      assert.ok(charCount(post.text) <= TEXT_MAX);

      const resumed = spawnsOf(run.fake).slice(2);
      assert.deepEqual(resumed.map((spawn) => spawn.session).sort(), [...sessions].sort(), "same session files");
      const resumePrompts = promptTexts(run.fake).filter((text) => text.startsWith(RESUME_PROMPT_HEADER));
      assert.equal(resumePrompts.length, 2);
      for (const text of resumePrompts) assert.ok(text.includes(`[swarm message #${feedback.id}]`));
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
      agentNames: ["Maria", "John"],
      runnerPid: deadPid,
      now,
    });
    markSwarmRunning(db, swarm.id, deadPid, now);

    const outcome = resumeSwarm(run.env, { swarmId: swarm.id, message: "Carry on." }, {});
    assert.equal(newestSwarmId(db), swarm.id);
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
    const kickoffs = promptTexts(run.fake).filter((text) => text.startsWith("Task for the swarm:"));
    assert.equal(kickoffs.length, 2);
    for (const text of kickoffs) assert.ok(text.includes('"Carry on."'));
  });
});

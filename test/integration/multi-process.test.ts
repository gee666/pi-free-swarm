import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { sweepStaleRuns } from "../../src/broker/swarms.js";
import { resumeSwarm } from "../../src/broker/swarm-run.js";
import { PARENT_WATCH_INTERVAL_MS, RESUME_PROMPT_HEADER, UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { getSwarm, listSwarms } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  isAlive,
  promptTexts,
  recipientStatus,
  spawnsOf,
  systemReplies,
  waitFor,
} from "./run-fixture.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const runnerScript = fileURLToPath(new URL("./fixtures/runner-child.ts", import.meta.url));
const run = createRunFixture(SCENARIOS.settle);
after(() => run.cleanup());

describe("a runner in another process", () => {
  it(
    "delivers the board's messages, and after kill -9 its swarm is swept and resumable here",
    { timeout: 60_000 },
    async () => {
      const { db } = run;
      const runner = spawn(
        process.execPath,
        ["--import", "tsx/esm", runnerScript, run.cwd, JSON.stringify(run.fake.env)],
        {
          cwd: repoRoot,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      runner.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const exited = once(runner, "exit");
      try {
        await waitFor(() => listSwarms(db, Date.now()).length > 0, `the child's swarm (${stderr})`, 15_000);
        const swarmId = listSwarms(db, Date.now())[0].id;
        const [first, second] = agentNames(db, swarmId);
        await waitFor(() => agentStatus(db, swarmId, first) === "idle", "first agent idle", 15_000);

        // Written here, as the board's API would: only the child's poll can deliver it.
        const fromBoard = sendMessage(db, swarmId, "User", [first], "from the board", Date.now()).id;
        await waitFor(() => recipientStatus(db, fromBoard, first) === "read", "delivered by the child runner");
        const waiting = sendMessage(db, swarmId, "User", [second], "you have not started", Date.now());
        assert.equal(recipientStatus(db, waiting.id, second), "pending");

        const [agent] = spawnsOf(run.fake);
        runner.kill("SIGKILL");
        await exited;
        const killedAt = Date.now();
        await waitFor(() => !isAlive(agent.pid), "the orphaned agent exits", PARENT_WATCH_INTERVAL_MS + 2_000);
        assert.ok(Date.now() - killedAt <= PARENT_WATCH_INTERVAL_MS + 2_000);

        assert.deepEqual(sweepStaleRuns(db, Date.now()), [swarmId]);
        assert.equal(getSwarm(db, swarmId, Date.now())?.status, "interrupted");
        assert.equal(recipientStatus(db, waiting.id, second), "undeliverable");
        assert.deepEqual(systemReplies(db, waiting.threadId), [UNDELIVERABLE_REPLY_TEXT]);

        const resumed = await resumeSwarm(run.env, { swarmId, message: "Pick it up from here." }, {});
        assert.equal(resumed.end, "finished");
        assert.equal(resumed.run, 2);
        const texts = promptTexts(run.fake);
        assert.ok(
          texts.some((text) => text.startsWith(RESUME_PROMPT_HEADER)),
          "the first agent resumes its session",
        );
        assert.ok(
          texts.filter((text) => text.startsWith("Task for the swarm:")).length === 2,
          "the second one kicks off",
        );
      } finally {
        if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
      }
    },
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { systemNotice } from "../helpers/system-notice.js";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { readBudget } from "../../src/store/budget.js";
import { listOpenAgentRecipients } from "../../src/store/message-queries.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  isAlive,
  newestSwarmId,
  recipientStatus,
  spawnsOf,
  finishWork,
  waitFor,
  waitForWorkersIdle,
} from "./run-fixture.js";

for (const graceful of [false, true]) {
  test(
    `time budget ${graceful ? "finishes the active turn" : "interrupts immediately"} and resumes cumulatively`,
    { timeout: 25_000 },
    async () => {
      const run = createRunFixture({ spawns: [SCENARIOS.longTool(2500), SCENARIOS.settle] }, { staggerSeconds: 20 });
      const clock = new FakeClock();
      const env = {
        ...run.env,
        clock,
        settings: { ...run.env.settings, budgetTimeSeconds: 1, gracefulShutdownOnBudget: graceful },
      };
      const cancel = new AbortController();
      const first = startSwarm(
        env,
        {
          name: "budget-resume",
          taskPrompt: "Preserve progress and unread messages.",
          acceptanceCriteria: ["Fixture evidence is complete."],
          agentAmount: 2,
        },
        { signal: cancel.signal },
      );
      const swarmId = newestSwarmId(run.db);
      const names = agentNames(run.db, swarmId);
      clock.advance(0);
      try {
        await waitFor(
          () =>
            run.db.sql
              .prepare("SELECT 1 FROM participants WHERE swarm_id = ? AND activity LIKE '%tool%'")
              .get(swarmId) !== undefined,
          "active tool before budget expiry",
        );
        const unread = systemNotice(run.db, {
          swarmId: swarmId,
          to: names[1],
          text: "Preserve this unread work",
          now: clock.now(),
        });
        const post = createPost(
          run.db,
          swarmId,
          names[0],
          { title: "Budget evidence", text: "Keep queued comments recoverable." },
          clock.now(),
        );
        addComment(run.db, swarmId, "User", post.id, "Queued during the active tool.", clock.now());
        clock.advance(50);
        const queued = listOpenAgentRecipients(run.db, swarmId).find((recipient) => recipient.name === names[0]);
        assert.ok(queued);
        await waitFor(
          () => recipientStatus(run.db, queued.messageId, names[0]) === "delivered",
          "comment steering accepted before budget drain",
        );
        clock.advance(950);
        if (graceful) {
          await waitFor(() => agentStatus(run.db, swarmId, names[0]) === "idle", "active turn finishes while draining");
          clock.advance(25);
        }
        const stopped = await first;
        assert.equal(stopped.end, "stopped");
        assert.equal(stopped.stopReason, "budget-exhausted");

        assert.equal(recipientStatus(run.db, unread.id, names[1]), "pending");
        assert.equal(recipientStatus(run.db, queued.messageId, names[0]), "delivered");

        if (graceful) assert.ok(run.fake.log().some((record) => record.type === "clear_queue"));
        assert.ok(stopped.budget);
        assert.ok(stopped.budget.activeTimeMs >= 1000);
        assert.match(stopped.budget.accounting, /uncertain/);
        const session = listAgentSessions(run.db, swarmId).find((worker) => worker.name === names[0]);
        assert.ok(session);
        const completedTool = readFileSync(session.sessionFile, "utf8").includes('"role":"toolResult"');
        assert.equal(completedTool, graceful, "only graceful mode permits the active tool to finish");
        assert.ok(
          spawnsOf(run.fake).every(({ pid }) => !isAlive(pid)),
          "all first-run children are reaped",
        );
        clock.advance(86_400_000);
        const frozen = readBudget(run.db, swarmId, env.settings, clock.now());
        assert.equal(frozen.activeTimeMs, stopped.budget.activeTimeMs, "stopped time is not charged");

        const spawnCount = spawnsOf(run.fake).length;
        const stillExhausted = await resumeSwarm(
          env,
          { swarmId, message: "Inspect the saved budget without increasing it." },
          {},
        );
        assert.equal(stillExhausted.stopReason, "budget-exhausted");
        assert.equal(
          spawnsOf(run.fake).length,
          spawnCount,
          "an exhausted unchanged ceiling admits no child or action replay",
        );
        assert.equal(recipientStatus(run.db, unread.id, names[1]), "pending");

        // This explicit raised ceiling represents Main applying an already user-approved increase.
        const resumedEnv = { ...env, settings: { ...env.settings, budgetTimeSeconds: 12, staggerSeconds: 0 } };
        const resumeCancel = new AbortController();
        const resumed = resumeSwarm(
          resumedEnv,
          { swarmId, message: "User approved the new total ceiling. Verify artifacts before continuing." },
          { signal: resumeCancel.signal },
        );
        try {
          clock.advance(50);
          await waitForWorkersIdle(run, swarmId);
          assert.equal(recipientStatus(run.db, unread.id, names[1]), "read");
          assert.equal(recipientStatus(run.db, queued.messageId, names[0]), "read");

          finishWork(run.db, swarmId);
          clock.advance(25);
          const completed = await resumed;
          assert.equal(completed.end, "finished");
          assert.equal(completed.stopReason, undefined);
          assert.ok(completed.budget);
          assert.equal(completed.budget.timeSeconds, 12);
          assert.ok(
            completed.budget.activeTimeMs > stopped.budget.activeTimeMs,
            "resume accumulates rather than resets active time",
          );
          assert.ok(
            run.notes.some((note) => note.includes("configuration changed")),
            "raised policy is surfaced",
          );
        } finally {
          resumeCancel.abort();
          await resumed;
        }
      } finally {
        cancel.abort();
        await first;
        run.cleanup();
      }
    },
  );
}

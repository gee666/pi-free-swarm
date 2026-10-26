import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { listFreshComments } from "../../src/store/wall-coverage.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  createRunFixture,
  newestSwarmId,
  recipientStatus,
  voteAll,
  waitFor,
  waitForWorkersIdle,
} from "./run-fixture.js";

for (const graceful of [false, true]) {
  test(
    `budget ${graceful ? "graceful" : "immediate"} stop retains unobserved subscribed comments until approved resume`,
    { timeout: 25_000 },
    async () => {
      const run = createRunFixture({ spawns: [SCENARIOS.longTool(1800), SCENARIOS.settle] }, { staggerSeconds: 20 });
      const startedAt = Date.now();
      let pendingStartup = true;
      const env = {
        ...run.env,
        // Process startup must not exhaust the budget before the test can publish its evidence.
        clock: { ...run.env.clock, now: () => (pendingStartup ? startedAt : Date.now()) },
        settings: { ...run.env.settings, budgetTimeSeconds: 1, gracefulShutdownOnBudget: graceful },
      };
      const cancel = new AbortController();
      const first = startSwarm(
        env,
        {
          name: "budget-comment-retention",
          taskPrompt: "Preserve discussion evidence.",
          acceptanceCriteria: ["Unobserved subscribed comments survive budget stop."],
          agentAmount: 2,
        },
        { signal: cancel.signal },
      );
      const swarmId = newestSwarmId(run.db);
      const names = agentNames(run.db, swarmId);
      try {
        await waitFor(
          () =>
            run.db.sql
              .prepare("SELECT 1 FROM participants WHERE swarm_id = ? AND activity LIKE '%tool%'")
              .get(swarmId) !== undefined,
          "active child tool",
        );
        const post = createPost(
          run.db,
          swarmId,
          names[1],
          { title: "Recovery evidence", text: "Pending owner" },
          Date.now(),
        );
        const comment = addComment(
          run.db,
          swarmId,
          "User",
          post.id,
          "Inspect this evidence after the approved increase.",
          Date.now(),
        ).comment;
        const row = run.db.sql
          .prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?")
          .get(comment.id);
        assert.ok(row && typeof row.message_id === "number");
        const notificationId = row.message_id;
        pendingStartup = false;
        const stopped = await first;
        assert.equal(stopped.stopReason, "budget-exhausted");
        assert.equal(recipientStatus(run.db, notificationId, names[1]), "pending");
        assert.equal(
          listFreshComments(run.db, swarmId, names[1], post.id, 10).total,
          1,
          "neither queueing nor shutdown consumes unseen comments",
        );
        assert.equal(stopped.acceptance.counts.accepted, 0);
        const raisedEnv = { ...env, settings: { ...env.settings, budgetTimeSeconds: 12, staggerSeconds: 0 } };
        const resumed = resumeSwarm(
          raisedEnv,
          { swarmId, message: "User approved the higher cumulative ceiling. Verify saved evidence before acting." },
          { signal: cancel.signal },
        );
        try {
          await waitForWorkersIdle(run, swarmId);
          assert.equal(recipientStatus(run.db, notificationId, names[1]), "read");
          assert.equal(listFreshComments(run.db, swarmId, names[1], post.id, 10).total, 0);
          const texts = run.fake
            .log()
            .filter((entry) => entry.type === "prompt")
            .map((entry) => String(entry.message));
          assert.ok(
            texts.some(
              (text) =>
                text.includes(`Comment #${comment.id} on post #${post.id} by User:`) && text.includes(comment.text),
            ),
          );
          voteAll(run.db, swarmId, "accepted", "Retained notification entered the resumed worker context.");
          assert.equal((await resumed).end, "finished");
        } finally {
          cancel.abort();
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

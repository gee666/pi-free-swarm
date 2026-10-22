import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { listFreshComments } from "../../src/store/wall-coverage.js";
import { getParticipant } from "../../src/store/swarm-queries.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  createRunFixture,
  newestSwarmId,
  recipientStatus,
  voteAll,
  waitFor,
  waitForWorkersIdle,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

it(
  "real child observes native all-queued comments before only-new coverage advances",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.steer);
    fixture = run;
    const outcome = startSwarm(
      run.env,
      {
        name: "comment coverage",
        taskPrompt: "Work.",
        acceptanceCriteria: ["Comments reach context."],
        agentAmount: 1,
      },
      {},
    );
    const swarmId = newestSwarmId(run.db);
    const [name] = agentNames(run.db, swarmId);
    assert.ok(name);
    const tools = createAgentToolHandlers({ getDb: () => run.db, swarmId, run: 1, agentName: name });
    const post = createPost(run.db, swarmId, name, { title: "Discussion", text: "source evidence" }, Date.now());
    tools.readPost({ post_id: post.id, only_new: true });
    await waitFor(() => {
      const worker = getParticipant(run.db, swarmId, name);
      return worker?.kind === "agent" && worker.activity?.kind === "tool";
    }, "busy real tool");
    const one = addComment(run.db, swarmId, "User", post.id, "first actual comment", Date.now()).comment;
    const two = addComment(run.db, swarmId, "User", post.id, "second actual comment", Date.now()).comment;
    const notifications = run.db.sql
      .prepare(
        "SELECT n.message_id FROM comment_notifications n JOIN messages m ON m.id = n.message_id WHERE m.swarm_id = ? ORDER BY n.comment_id",
      )
      .all(swarmId)
      .map((row) => Number(row.message_id));
    assert.equal(notifications.length, 2);
    await waitFor(
      () => notifications.every((id) => recipientStatus(run.db, id, name) === "delivered"),
      "comments accepted by native queue",
    );
    assert.deepEqual(
      listFreshComments(run.db, swarmId, name, post.id, 20).comments.map((comment) => comment.id),
      [one.id, two.id],
    );
    await waitFor(
      () => notifications.every((id) => recipientStatus(run.db, id, name) === "read"),
      "comments observed in context",
    );
    assert.equal(listFreshComments(run.db, swarmId, name, post.id, 20).total, 0);
    assert.doesNotMatch(tools.readPost({ post_id: post.id, only_new: true }), /actual comment/);
    const log = run.fake.log();
    assert.ok(log.some((record) => record.type === "set_steering_mode" && record.mode === "all"));
    const prompts = log.filter((record) => record.type === "prompt").map((record) => String(record.message));
    assert.ok(
      prompts.some(
        (text) => text.includes(`Comment #${one.id} on post #${post.id}`) && text.includes("first actual comment"),
      ),
    );
    assert.ok(
      prompts.some(
        (text) => text.includes(`Comment #${two.id} on post #${post.id}`) && text.includes("second actual comment"),
      ),
    );
    setPostSubscription(run.db, swarmId, name, post.id, false, Date.now());
    addComment(run.db, swarmId, name, post.id, "opt-out survives participation", Date.now());
    addComment(run.db, swarmId, "User", post.id, "history after opt-out", Date.now());
    assert.equal(
      run.db.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM comment_notifications n JOIN messages m ON m.id = n.message_id JOIN message_recipients r ON r.message_id = m.id WHERE m.swarm_id = ? AND r.name = ?",
        )
        .get(swarmId, name)?.n,
      2,
    );
    assert.match(tools.readPost({ post_id: post.id, only_new: true }), /history after opt-out/);
    await waitForWorkersIdle(run, swarmId);
    voteAll(run.db, swarmId, "accepted", "Queued observation and persistent comment coverage verified.");
    assert.equal((await outcome).end, "finished");
  },
);

import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { IDLE_REMINDER_HEADER } from "../../src/constants.js";
import { listFreshComments, listFreshPosts } from "../../src/store/wall-coverage.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  voteAll,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(async () => {
  await stopAllRuns();
  fixture?.cleanup();
});

it(
  "native comment delivery and tool reads share observed coverage with fresh reminders",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.steer, {
      reminders: { idleReminderDelay: 30, idleReminderDigestSize: 2 },
    });
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(
      run.env,
      {
        name: "wall-coverage",
        taskPrompt: "Verify notification and reminder interactions.",
        acceptanceCriteria: ["Notifications and reminders cover only observed full content."],
        agentAmount: 2,
      },
      {},
    );
    const swarmId = newestSwarmId(db);
    const [author, commenter] = agentNames(db, swarmId);
    await waitFor(() => [author, commenter].every((name) => agentStatus(db, swarmId, name) === "working"), "both busy");
    const post = createPost(
      db,
      swarmId,
      author,
      { title: "Evidence", text: "Unique full post evidence body" },
      Date.now(),
    );
    const first = addComment(db, swarmId, commenter, post.id, "First unique comment evidence", Date.now()).comment;
    const second = addComment(db, swarmId, commenter, post.id, "Second unique comment evidence", Date.now()).comment;
    const tool = createAgentToolHandlers({ getDb: () => db, swarmId, run: 1, agentName: commenter });
    assert.match(tool.readPosts({ only_new: true }), /Unique full post evidence body/);
    assert.equal(listFreshPosts(db, swarmId, commenter, 10).total, 0);
    await waitFor(
      () =>
        db.sql
          .prepare(
            `SELECT COUNT(*) AS n FROM message_recipients r
    JOIN comment_notifications n ON n.message_id = r.message_id
    WHERE r.name = ? AND r.status = 'delivered'`,
          )
          .get(author)?.n === 2,
      "two queued comments",
    );
    assert.equal(listFreshComments(db, swarmId, author, post.id, 10).total, 2, "queued is not observed");
    assert.equal(
      db.sql
        .prepare(
          `SELECT COUNT(*) AS n FROM message_recipients r
    JOIN comment_notifications n ON n.message_id = r.message_id WHERE r.name = ?`,
        )
        .get(commenter)?.n,
      0,
      "no self notices",
    );
    await waitFor(
      () => listFreshComments(db, swarmId, author, post.id, 10).total === 0,
      "comments observed in context",
    );
    const reminderTexts = () => promptTexts(run.fake).filter((text) => text.startsWith(IDLE_REMINDER_HEADER));
    await waitFor(() => reminderTexts().length >= 4, "two reminder turns per worker", 10_000);
    const reminders = reminderTexts();
    assert.equal(
      reminders.filter((text) => text.includes(post.text)).length,
      1,
      "tool-covered worker receives no replay, other worker receives full post once",
    );
    assert.ok(
      reminders.every((text) => !text.includes(first.text) && !text.includes(second.text)),
      "no duplicate comment digest",
    );
    assert.equal(listFreshPosts(db, swarmId, author, 10).total, 0);
    const modes = run.fake.log().filter((record) => record.type === "set_steering_mode");
    assert.ok(modes.length >= 2);
    assert.ok(modes.every((record) => record.mode === "all"));
    voteAll(db, swarmId, "accepted", "Native notification observations and fresh reminders verified.");
    assert.equal((await outcome).end, "finished");
  },
);

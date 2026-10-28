import assert from "node:assert/strict";
import { test } from "node:test";
import { mentionedNames } from "../../src/mentions.js";
import { createPost, addComment } from "../../src/broker/wall.js";
import { markUserCommentsRead } from "../../src/broker/user-comment-read.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { COMMENT_NOTICE_WINDOW_MS } from "../../src/constants.js";
import { userPostStates } from "../../src/store/user-post-state.js";
import { userUnreadSummary } from "../../src/store/user-unread.js";
import type { SwarmDb } from "../../src/store/db.js";
import { workRoster } from "../../src/store/work-roster.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { FakeClock } from "../agents/fake-clock.js";
import { workFixture } from "../helpers/work-graph.js";

function notices(db: SwarmDb) {
  return db.sql
    .prepare(
      `SELECT m.sender, m.body, r.name FROM messages m
    JOIN message_recipients r ON r.message_id = m.id ORDER BY m.id`,
    )
    .all();
}

test("mentions match whole participant names case-insensitively and deduplicate", () => {
  assert.deepEqual(mentionedNames("@Ann @ann @ANN! @Ann2 @Ann_ @unknown x@Ann @@Ann @Zoë @李", ["Ann", "Zoë", "李"]), [
    "Ann",
    "Zoë",
    "李",
  ]);
});

test("all authors can mention participants without subscribing them, including User attention", (t) => {
  const f = workFixture(t);
  const now = f.input().now;
  const body = `@bEn @Ben @Ann @User ${"😀".repeat(130)}`;
  const post = createPost(f.db, f.swarmId, "Ann", { title: "Decision", text: body }, now);
  assert.deepEqual(
    notices(f.db).map((row) => [row.sender, row.name, row.body]),
    [
      [
        "System",
        "Ben",
        `Ann mentioned you in post #${post.id} "Decision": ${Array.from(body).slice(0, 120).join("")}. Read with swarm_posts_get.`,
      ],
    ],
  );
  assert.deepEqual(
    f.db.sql
      .prepare("SELECT name FROM post_subscriptions WHERE post_id = ?")
      .all(post.id)
      .map((row) => row.name),
    ["Ann"],
  );
  assert.equal(userPostStates(f.db, f.swarmId, [post.id]).get(post.id)?.userUnreadComments, 1);
  assert.equal(markUserCommentsRead(f.db, f.swarmId, post.id, [], now).updated, 1);
  const { comment } = addComment(
    f.db,
    f.swarmId,
    "Watcher",
    post.id,
    "@User @Ben here is the recorded evidence",
    now + 1,
  );
  assert.equal(userPostStates(f.db, f.swarmId, [post.id]).get(post.id)?.userSubscribed, false);
  assert.equal(userUnreadSummary(f.db, f.swarmId).comments, 1);
  assert.equal(markUserCommentsRead(f.db, f.swarmId, post.id, [comment.id], now + 2).updated, 1);
  assert.equal(userUnreadSummary(f.db, f.swarmId).comments, 0);
  assert.equal(notices(f.db).filter((row) => row.name === "Ben").length, 2);
  assert.equal(notices(f.db).filter((row) => row.name === "User").length, 0);
});

test("mentions bypass subscriber throttles without a second notice for the same comment", (t) => {
  const f = workFixture(t);
  const now = f.input().now;
  const post = createPost(f.db, f.swarmId, "Ann", { title: "Discuss", text: "Body" }, now);
  setPostSubscription(f.db, f.swarmId, "Ben", post.id, true, now);
  addComment(f.db, f.swarmId, "Cam", post.id, "First ordinary comment", now + 1);
  addComment(f.db, f.swarmId, "Cam", post.id, "@Ben explicit mention", now + 2);
  addComment(f.db, f.swarmId, "Cam", post.id, "@ben repeated mention", now + 3);
  addComment(f.db, f.swarmId, "Cam", post.id, "Still throttled", now + 4);
  assert.equal(notices(f.db).filter((row) => row.name === "Ben").length, 3);
  addComment(f.db, f.swarmId, "Cam", post.id, "Window expired", now + COMMENT_NOTICE_WINDOW_MS + 1);
  assert.equal(notices(f.db).filter((row) => row.name === "Ben").length, 4);
});

test("only explicit User and Watcher broadcasts notify every active worker without subscribing recipients", (t) => {
  const f = workFixture(t);
  const now = f.input().now;
  createPost(f.db, f.swarmId, "User", { title: "Ordinary", text: "Discover through search" }, now);
  assert.deepEqual(notices(f.db), []);
  const agents = workRoster(f.db, f.swarmId)
    .filter((agent) => agent.active)
    .map((agent) => agent.name)
    .sort();
  for (const author of ["User", "Watcher"]) {
    const text = "😀".repeat(201);
    const post = createPost(f.db, f.swarmId, author, { title: "Broadcast", text, broadcast: true }, now);
    assert.equal(post.broadcast, true);
    const rows = notices(f.db).filter((row) => String(row.body).includes(`#${post.id} `));
    assert.deepEqual(rows.map((row) => row.name).sort(), agents);
    assert.ok(
      rows.every(
        (row) =>
          row.body ===
          `${author} broadcast post #${post.id} "Broadcast": ${"😀".repeat(200)}. Read it with swarm_posts_get.`,
      ),
    );
    assert.deepEqual(
      f.db.sql
        .prepare("SELECT name FROM post_subscriptions WHERE post_id = ?")
        .all(post.id)
        .map((row) => row.name),
      [author],
    );
  }
  assert.throws(
    () => createPost(f.db, f.swarmId, "Ann", { title: "No", text: "No", broadcast: true }, now),
    /Only User and Watcher/,
  );
  assert.throws(
    () => createPost(f.db, f.swarmId, "User", { title: "No", text: "No", broadcast: "true" }, now),
    /must be true or false/,
  );
});

test("broadcast mentions combine worker notices and retain User and Watcher attention", (t) => {
  const f = workFixture(t);
  const post = createPost(
    f.db,
    f.swarmId,
    "User",
    { title: "Combined", text: "@Ann @Watcher @User", broadcast: true },
    f.input().now,
  );
  const rows = notices(f.db);
  const ann = rows.filter((row) => row.name === "Ann");
  assert.equal(ann.length, 1);
  assert.ok(String(ann[0].body).startsWith("User broadcast post"));
  assert.ok(String(ann[0].body).endsWith(" You are mentioned."));
  const watcher = rows.filter((row) => row.name === "Watcher");
  assert.equal(watcher.length, 1);
  assert.ok(String(watcher[0].body).startsWith("User mentioned you"));
  assert.equal(userUnreadSummary(f.db, f.swarmId).comments, 0, "self mentions do not create attention");
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM post_subscriptions WHERE post_id = ?").get(post.id)?.n, 1);
});

test("Watcher participates with post tools and comments explain subscription and opt-out", (t) => {
  const f = workFixture(t);
  const run = createAgentToolHandlers({
    getDb: () => f.db,
    swarmId: f.swarmId,
    run: 1,
    agentName: "Watcher",
    clock: new FakeClock(f.input().now),
  });
  const output = run.postsCreate({ title: "Overview", body: "Recorded activity", broadcast: true });
  const id = Number(/#(\d+)/.exec(output)?.[1]);
  const guidance = `You are subscribed to post #${id}; unsubscribe with swarm_posts_unsubscribe.`;
  assert.ok(output.includes(guidance));
  assert.ok(run.postsComment({ post_id: id, body: "More evidence" }).includes(guidance));
  run.postsUnsubscribe({ post_id: id });
  assert.ok(
    run.postsComment({ post_id: id, body: "Stay opted out" }).includes(`You are not subscribed to post #${id}.`),
  );
  assert.throws(
    () =>
      createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: "Ann" }).postsCreate({
        title: "No",
        body: "No",
        broadcast: true,
      }),
    /Only User and Watcher/,
  );
});

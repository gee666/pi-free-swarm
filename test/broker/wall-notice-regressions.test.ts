import assert from "node:assert/strict";
import { test } from "node:test";
import { addComment, createPost } from "../../src/broker/wall.js";
import { getPostPage } from "../../src/broker/post-queries.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { COMMENT_NOTICE_CHARS, COMMENT_NOTICE_WINDOW_MS, USER_POST_NOTICE_CHARS } from "../../src/constants.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getMessages } from "../../src/store/message-queries.js";
import { workFixture } from "../helpers/work-graph.js";

test("User broadcasts notify every active worker once without subscribing them or notifying Watcher", (t) => {
  const f = workFixture(t);
  f.db.sql.prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND name = 'Ben'").run(f.swarmId);
  f.db.sql
    .prepare("UPDATE participants SET status = 'stopped', retired_at = ? WHERE swarm_id = ? AND name = 'Cam'")
    .run(f.input().now, f.swarmId);
  const body = "😀".repeat(USER_POST_NOTICE_CHARS + 1);
  const post = createPost(f.db, f.swarmId, "User", { title: "criteria", text: body, broadcast: true }, f.input().now);
  const messages = getMessages(
    f.db,
    f.db.sql
      .prepare("SELECT id FROM messages")
      .all()
      .map((row) => Number(row.id)),
  );
  assert.deepEqual(
    messages.map((message) => message.recipients.map((recipient) => recipient.name)),
    [["Ann"], ["Dan"]],
  );
  for (const message of messages) {
    assert.equal(message.sender, "System");
    assert.equal(
      message.text,
      `User broadcast post #${post.id} "criteria": ${Array.from(body).slice(0, USER_POST_NOTICE_CHARS).join("")}. Read it with swarm_posts_get.`,
    );
  }
  assert.deepEqual(
    f.db.sql
      .prepare("SELECT name FROM post_subscriptions WHERE post_id = ?")
      .all(post.id)
      .map((row) => row.name),
    ["User"],
  );
  createPost(f.db, f.swarmId, "Ann", { title: "Agent post", text: "Discover through search" }, f.input().now);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM messages").get()?.n, 2);
});

test("comment notices throttle each recipient and post across handles, expire at the boundary without dropping readable comments", (t) => {
  const f = workFixture(t);
  const now = f.input().now;
  const post = createPost(f.db, f.swarmId, "Ann", { title: "criteria", text: "Discuss" }, now);
  const other = createPost(f.db, f.swarmId, "Ann", { title: "Other", text: "Discuss" }, now);
  setPostSubscription(f.db, f.swarmId, "Ben", post.id, true, now);
  const notices = (name: string, postId = post.id) =>
    f.db.sql
      .prepare(
        `SELECT m.id, m.body FROM comment_notifications n JOIN messages m ON m.id = n.message_id
     JOIN message_recipients r ON r.message_id = m.id WHERE n.post_id = ? AND r.name = ? ORDER BY m.id`,
      )
      .all(postId, name);
  const body = "😀".repeat(COMMENT_NOTICE_CHARS + 1);
  addComment(f.db, f.swarmId, "Ben", post.id, body, now + 1);
  addComment(f.db, f.swarmId, "Cam", post.id, "second", now + 2);
  addComment(f.db, f.swarmId, "Dan", post.id, "third", now + 3);
  assert.equal(notices("Ann").length, 1);
  assert.equal(notices("Ben").length, 1, "Ben has his own window, starting with Cam's comment");
  assert.equal(notices("Cam").length, 1);
  assert.equal(
    notices("Ann")[0]?.body,
    `New comments on post #${post.id} "criteria" (latest by Ben: ${Array.from(body).slice(0, COMMENT_NOTICE_CHARS).join("")}). Read with swarm_posts_get.`,
  );
  addComment(f.db, f.swarmId, "Ben", other.id, "other post", now + 4);
  assert.equal(notices("Ann", other.id).length, 1, "posts have independent windows");
  const reopened = openSwarmDb(f.db.path, { create: false });
  t.after(() => reopened.close());
  addComment(reopened, f.swarmId, "Dan", post.id, "still inside window", now + COMMENT_NOTICE_WINDOW_MS);
  assert.equal(notices("Ann").length, 1);
  addComment(reopened, f.swarmId, "Dan", post.id, "latest after window", now + COMMENT_NOTICE_WINDOW_MS + 1);
  assert.equal(notices("Ann").length, 2);
  assert.match(String(notices("Ann")[1]?.body), /latest by Dan: latest after window/);
  assert.equal(notices("Ben").length, 1);
  addComment(f.db, f.swarmId, "Dan", post.id, "Ben's next window", now + COMMENT_NOTICE_WINDOW_MS + 2);
  assert.equal(notices("Ann").length, 2);
  assert.equal(notices("Ben").length, 2);
  assert.equal(getPostPage(f.db, f.swarmId, post.id).comments.length, 6, "suppressed comments remain readable");
});

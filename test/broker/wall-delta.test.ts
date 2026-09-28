import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { sendMainFeedback, sendMessage, replyToThread } from "../../src/broker/messages.js";
import { initialWallCursor, readWallDeltaAs } from "../../src/broker/wall-delta.js";
import { addComment, createPost, readPostsAs } from "../../src/broker/wall.js";
import { MAIN_FEEDBACK_MAX } from "../../src/limits.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getPostDetail } from "../../src/store/wall-queries.js";
import { readWallTool } from "../../src/tools/wall-read.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

it("paginates durable revisions, including comments on old posts and concurrent writes", () => {
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const start = initialWallCursor(swarm.id);
  const post = createPost(db, swarm.id, "Maria", { title: "old", text: "x".repeat(400) }, T0);
  createPost(db, other.id, "Maria", { title: "unrelated", text: "x" }, T0);
  const later = createPost(db, swarm.id, "John", { title: "new", text: "y" }, T0);
  readPostsAs(db, swarm.id, "Maria", { count: 1, offset: 0 });
  const first = readWallDeltaAs(db, swarm.id, "Maria", start, 1);
  assert.equal(first.changes[0].id, post.id);
  assert.equal(first.changes[0].text.length, 400);
  assert.equal(first.changes[0].truncated, false);
  assert.equal(first.hasMore, true);
  assert.deepEqual(readWallDeltaAs(db, swarm.id, "Maria", start, 1), first);

  const secondHandle = openSwarmDb(db.path, { create: false });
  let commentId: number;
  try {
    commentId = addComment(secondHandle, swarm.id, "John", post.id, "old post update", T0 - 1).comment.id;
  } finally {
    secondHandle.close();
  }
  db.sql.exec("DELETE FROM events");
  const second = readWallDeltaAs(db, swarm.id, "Maria", first.nextCursor, 1);
  const third = readWallDeltaAs(db, swarm.id, "Maria", second.nextCursor, 1);
  assert.deepEqual(
    second.changes.map((c) => [c.kind, c.id]),
    [["post", later.id]],
  );
  assert.deepEqual(
    third.changes.map((c) => [c.kind, c.id, c.postId]),
    [["comment", commentId, post.id]],
  );
  assert.equal(third.hasMore, false);
  const empty = readWallDeltaAs(db, swarm.id, "Maria", third.nextCursor);
  assert.deepEqual(empty, { changes: [], hasMore: false, nextCursor: third.nextCursor });
  const final = addComment(db, swarm.id, "John", post.id, "after empty", T0).comment;
  assert.equal(readWallDeltaAs(db, swarm.id, "Maria", empty.nextCursor).changes[0].id, final.id);
  assert.match(readWallTool(db, swarm.id, "Maria", {}, T0), /Next cursor:/);
  assert.doesNotMatch(readWallTool(db, swarm.id, "Maria", { after: start, count: 1 }, T0), /for full text/);
});

it("cuts previews at the current ceiling only for bodies stored under a larger setting", () => {
  const isolated = createTempDb();
  try {
    const swarm = seedSwarm(isolated.db);
    const settings = path.join(isolated.db.dataDir, "settings.json");
    writeFileSync(settings, JSON.stringify({ bodyMaxChars: 8000 }));
    const post = createPost(isolated.db, swarm.id, "Maria", { title: "old", text: "x".repeat(1000) }, T0);
    writeFileSync(settings, JSON.stringify({ bodyMaxChars: 300 }));
    const [change] = readWallDeltaAs(isolated.db, swarm.id, "John", initialWallCursor(swarm.id)).changes;
    assert.deepEqual([change.text.length, change.truncated], [600, true]);
    assert.equal(getPostDetail(isolated.db, swarm.id, post.id)?.post.text.length, 1000);
    const list = readWallTool(isolated.db, swarm.id, "John", {}, T0);
    assert.ok(list.includes(`${"x".repeat(600)} … (read post #${post.id} for full text)`));
    assert.match(readWallTool(isolated.db, swarm.id, "John", { after: initialWallCursor(swarm.id) }, T0), /read post/);
  } finally {
    isolated.cleanup();
  }
});

it("rejects malformed, foreign cursors and invalid page sizes without consuming history", () => {
  const swarm = seedSwarm(db);
  for (const after of ["bad", "", initialWallCursor(swarm.id + 1)]) {
    assert.throws(() => readWallDeltaAs(db, swarm.id, "Maria", after), /Invalid wall cursor/);
  }
  for (const count of [0, -1, 1.5, 101]) {
    assert.throws(() => readWallDeltaAs(db, swarm.id, "Maria", initialWallCursor(swarm.id), count), /count must/);
  }
});

it("uses project settings for all bodies and stores up to the hidden ceiling as-is", () => {
  const isolated = createTempDb();
  try {
    const swarm = seedSwarm(isolated.db);
    writeFileSync(path.join(isolated.db.dataDir, "settings.json"), JSON.stringify({ bodyMaxChars: 8000 }));
    const body = "😀".repeat(8000);
    const post = createPost(isolated.db, swarm.id, "Maria", { title: "long", text: body }, T0);
    assert.equal(post.text, body);
    assert.equal(addComment(isolated.db, swarm.id, "John", post.id, body, T0).comment.text, body);
    const message = sendMessage(isolated.db, swarm.id, "Maria", ["John"], body, T0);
    assert.equal(message.text, body);
    assert.equal(replyToThread(isolated.db, swarm.id, "John", message.threadId, body, T0).text, body);
    const feedback = "😀".repeat(MAIN_FEEDBACK_MAX);
    assert.equal(sendMainFeedback(isolated.db, swarm.id, feedback, T0).text, feedback);
    const over = `${body}${body}`;
    assert.equal(addComment(isolated.db, swarm.id, "John", post.id, over, T0).comment.text, over);
    assert.throws(
      () => isolated.db.sql.prepare("UPDATE posts SET body = ? WHERE id = ?").run("x".repeat(16001), post.id),
      /CHECK/,
    );
  } finally {
    isolated.cleanup();
  }
});

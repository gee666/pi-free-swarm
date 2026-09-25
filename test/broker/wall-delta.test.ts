import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { sendMainFeedback, sendMessage, replyToThread } from "../../src/broker/messages.js";
import { initialWallCursor, readWallDeltaAs, WALL_PREVIEW_CHARS } from "../../src/broker/wall-delta.js";
import { addComment, createPost, readPostsAs } from "../../src/broker/wall.js";
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
  const post = createPost(db, swarm.id, "Maria", { title: "old", text: "x".repeat(1000) }, T0);
  createPost(db, other.id, "Maria", { title: "unrelated", text: "x" }, T0);
  const later = createPost(db, swarm.id, "John", { title: "new", text: "y" }, T0);
  readPostsAs(db, swarm.id, "Maria", { count: 1, offset: 0 });
  const first = readWallDeltaAs(db, swarm.id, "Maria", start, 1);
  assert.equal(first.changes[0].id, post.id);
  assert.equal(first.changes[0].text.length, WALL_PREVIEW_CHARS);
  assert.equal(first.changes[0].truncated, true);
  assert.equal(first.hasMore, true);
  assert.equal(getPostDetail(db, swarm.id, post.id)?.post.text.length, 1000);
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
  assert.match(readWallTool(db, swarm.id, "Maria", { after: start, count: 1 }, T0), /read post #\d+ for full text/);
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

it("uses project settings for all bodies and never silently truncates stored text", () => {
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
    assert.equal(sendMainFeedback(isolated.db, swarm.id, body, T0).text, body);
    assert.throws(() => addComment(isolated.db, swarm.id, "John", post.id, `${body}x`, T0), /8001\/8000/);
    assert.throws(
      () => isolated.db.sql.prepare("UPDATE posts SET body = ? WHERE id = ?").run("x".repeat(16001), post.id),
      /CHECK/,
    );
  } finally {
    isolated.cleanup();
  }
});

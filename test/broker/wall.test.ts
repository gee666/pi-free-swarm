import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { BrokerError } from "../../src/broker/errors.js";
import { addComment, createPost, readPostsAs } from "../../src/broker/wall.js";
import { getPostDetail } from "../../src/store/wall-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function brokerError(fn: () => unknown, code: string, message: string, field?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof BrokerError);
    assert.deepEqual([error.code, error.message, error.field], [code, message, field]);
    return true;
  });
}

describe("posts and comments", () => {
  const swarm = seedSwarm(db);

  it("creates posts and comments with canonical authors and trimmed text", () => {
    const post = createPost(db, swarm.id, "maria", { title: " Kickoff ", text: " I take the API. " }, T0);
    assert.deepEqual(post, {
      id: post.id,
      swarmId: swarm.id,
      author: "Maria",
      title: "Kickoff",
      text: "I take the API.",
      commentCount: 0,
      createdAt: T0,
    });
    const first = addComment(db, swarm.id, "John", post.id, "UI is mine", T0 + 1);
    const second = addComment(db, swarm.id, "User", post.id, "thanks", T0 + 2);
    assert.equal(first.commentCount, 1);
    assert.equal(second.commentCount, 2);
    assert.equal(second.comment.author, "User");
    const detail = getPostDetail(db, swarm.id, post.id);
    assert.equal(detail?.post.commentCount, 2);
    assert.deepEqual(
      detail?.comments.map((c) => c.text),
      ["UI is mine", "thanks"],
    );
  });

  it("validates with the exact messages", () => {
    brokerError(
      () => createPost(db, swarm.id, "Maria", { title: "", text: "x" }, T0),
      "validation",
      "Title is empty.",
      "title",
    );
    brokerError(
      () => createPost(db, swarm.id, "Maria", { title: "t".repeat(72), text: "x" }, T0),
      "validation",
      "Title too long: 72/60 characters. Shorten it.",
      "title",
    );
    brokerError(
      () => createPost(db, swarm.id, "Maria", { title: "ok", text: "x".repeat(243) }, T0),
      "validation",
      "Too long: 243/200 characters. Shorten it or point to a file path.",
      "text",
    );
    brokerError(() => addComment(db, swarm.id, "Maria", 9999, "hi", T0), "not_found", "Post #9999 not found.");
    const other = seedSwarm(db);
    const foreign = createPost(db, other.id, "Maria", { title: "other", text: "swarm" }, T0);
    brokerError(
      () => addComment(db, swarm.id, "Maria", foreign.id, "hi", T0),
      "not_found",
      `Post #${foreign.id} not found.`,
    );
  });
});

describe("readPostsAs", () => {
  it("flags posts newer than the reader's mark and not its own, and advances the mark", () => {
    const swarm = seedSwarm(db);
    const ids = ["Maria", "John", "Maria", "Liam"].map(
      (author, i) => createPost(db, swarm.id, author, { title: `p${i}`, text: "t" }, T0 + i).id,
    );
    const first = readPostsAs(db, swarm.id, "Maria", { count: 2, offset: 0 });
    assert.deepEqual(
      first.page.posts.map((p) => p.id),
      [ids[3], ids[2]],
    );
    assert.equal(first.page.total, 4);
    assert.deepEqual(first.newPostIds, [ids[3]]);

    // Older page: the mark is already past these posts.
    assert.deepEqual(readPostsAs(db, swarm.id, "Maria", { count: 2, offset: 2 }).newPostIds, []);
    assert.deepEqual(readPostsAs(db, swarm.id, "Maria", { count: 20, offset: 0 }).newPostIds, []);

    const later = createPost(db, swarm.id, "John", { title: "later", text: "t" }, T0 + 9).id;
    assert.deepEqual(readPostsAs(db, swarm.id, "maria", { count: 20, offset: 0 }).newPostIds, [later]);
    assert.deepEqual(readPostsAs(db, swarm.id, "John", { count: 20, offset: 0 }).newPostIds, [ids[3], ids[2], ids[0]]);
  });

  it("validates the page", () => {
    const swarm = seedSwarm(db);
    brokerError(
      () => readPostsAs(db, swarm.id, "Maria", { count: 0, offset: 0 }),
      "validation",
      "count must be an integer 1–100.",
      "count",
    );
    brokerError(
      () => readPostsAs(db, swarm.id, "Maria", { count: 101, offset: 0 }),
      "validation",
      "count must be an integer 1–100.",
      "count",
    );
    brokerError(
      () => readPostsAs(db, swarm.id, "Maria", { count: 5, offset: -1 }),
      "validation",
      "offset must be an integer >= 0.",
      "offset",
    );
  });
});

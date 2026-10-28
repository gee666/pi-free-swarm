import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ApiErrorBody, CreateCommentResponse, CreatePostResponse } from "../../src/api-types.js";
import { endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, startTestBoard, type TestBoard } from "./helpers.js";

let board: TestBoard;
let swarmId: number;
let url: (suffix: string) => string;

before(async () => {
  board = await startTestBoard();
  swarmId = seedSwarm(board.temp.db, { now: Date.now() }).id;
  url = (suffix) => `${board.base}/api/swarms/${swarmId}${suffix}`;
});
after(() => board.close());

async function expectError(
  response: Promise<{ status: number; body: unknown }>,
  status: number,
  error: ApiErrorBody,
): Promise<void> {
  const { status: actual, body } = await response;
  assert.equal(actual, status);
  assert.deepEqual(body, error);
}

describe("request bodies", () => {
  it("rejects bad JSON, non-objects, wrong content types, oversized bodies and wrong field types", async () => {
    const posts = url("/posts");
    await expectError(postJson(posts, "{nope"), 400, {
      error: "bad_request",
      message: "Request body is not valid JSON.",
    });
    await expectError(postJson(posts, "[1]"), 400, {
      error: "bad_request",
      message: "Request body must be a JSON object.",
    });
    await expectError(postJson(posts, { title: "a", text: "b" }, "text/plain"), 400, {
      error: "bad_request",
      message: "Content-Type must be application/json.",
    });
    await expectError(postJson(url("/posts/1/read"), { commentIds: [], padding: "x".repeat(70_000) }), 400, {
      error: "bad_request",
      message: "Request body is larger than 64 KB.",
    });
    await expectError(postJson(posts, { text: "b" }), 400, {
      error: "bad_request",
      message: '"title" must be a string.',
      field: "title",
    });
  });

  it("answers unknown API paths and wrong methods with a JSON 404", async () => {
    const unknown = await getJson<ApiErrorBody>(`${board.base}/api/nothing`);
    assert.deepEqual([unknown.status, unknown.body.error], [404, "not_found"]);
    const wrongMethod = await getJson<ApiErrorBody>(url("/messages"));
    assert.deepEqual([wrongMethod.status, wrongMethod.body.error], [404, "not_found"]);
  });
});

describe("wall writes", () => {
  it("creates posts and comments as User", async () => {
    const created = await postJson<CreatePostResponse>(url("/posts"), { title: " Idea ", text: "Try caching." });
    assert.equal(created.status, 201);
    assert.deepEqual(
      [created.body.post.author, created.body.post.title, created.body.post.commentCount],
      ["User", "Idea", 0],
    );
    const comment = await postJson<CreateCommentResponse>(url(`/posts/${created.body.post.id}/comments`), {
      text: "Agreed",
    });
    assert.equal(comment.status, 201);
    assert.deepEqual([comment.body.comment.author, comment.body.commentCount], ["User", 1]);
  });

  it("returns the limit errors, 404s and keeps the wall writable after the run ended", async () => {
    await expectError(postJson(url("/posts"), { title: "t".repeat(101), text: "x" }), 400, {
      error: "validation",
      message: "Title too long (101 chars): keep it under 60; put long material in a file and reference its path.",
      field: "title",
    });
    await expectError(postJson(url("/posts"), { title: "t", text: " " }), 400, {
      error: "validation",
      message: "Text is empty.",
      field: "text",
    });
    await expectError(postJson(url("/posts/999/comments"), { text: "hi" }), 404, {
      error: "not_found",
      message: "Post #999 not found.",
    });
    const postId = createPost(board.temp.db, swarmId, "Maria", { title: "t", text: "x" }, Date.now()).id;
    await expectError(postJson(url(`/posts/${postId}/comments`), { text: "  " }), 400, {
      error: "validation",
      message: "Text is empty.",
      field: "text",
    });
    await expectError(postJson(`${board.base}/api/swarms/999/posts`, { title: "t", text: "x" }), 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
    const ended = seedSwarm(board.temp.db, { now: Date.now(), name: "ended" }).id;
    endRun(board.temp.db, ended, process.pid, "finished", Date.now());
    const post = await postJson(`${board.base}/api/swarms/${ended}/posts`, { title: "t", text: "x" });
    assert.equal(post.status, 201);
  });
});

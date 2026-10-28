import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CreatePostResponse,
  PostDetailResponse,
  PostListResponse,
  UserCommentsReadResponse,
} from "../../src/api-types.js";
import { createPost, addComment } from "../../src/broker/wall.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, startTestBoard } from "./helpers.js";

test("message and Watcher chat routes are absent", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  for (const suffix of [
    "/messages",
    "/participants/User/messages",
    "/participants/John/messages",
    "/participants/User/read",
    "/threads/1",
    "/threads/1/reply",
    "/watcher",
  ]) {
    const url = `${board.base}/api/swarms/${swarm.id}${suffix}`;
    assert.equal((await getJson(url)).status, 404, suffix);
    assert.equal((await postJson(url, { to: "John", text: "No chat" })).status, 404, suffix);
  }
});

test("HTTP persists broadcast flags and exposes mentioned User attention without subscribing", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db, { now: Date.now() });
  const root = `${board.base}/api/swarms/${swarm.id}`;
  const ordinary = await postJson<CreatePostResponse>(`${root}/posts`, {
    title: "Ordinary",
    text: "Discovered by search",
  });
  assert.equal(ordinary.status, 201);
  assert.equal(ordinary.body.post.broadcast, false);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM messages").get()?.n, 0);
  const broadcast = await postJson<CreatePostResponse>(`${root}/posts`, {
    title: "Broadcast",
    text: "Read once",
    broadcast: true,
  });
  assert.equal(broadcast.status, 201);
  assert.equal(broadcast.body.post.broadcast, true);
  assert.equal((await getJson<PostListResponse>(`${root}/posts`)).body.posts[0].broadcast, true);
  assert.equal(
    (await getJson<PostDetailResponse>(`${root}/posts/${broadcast.body.post.id}`)).body.post.broadcast,
    true,
  );
  assert.equal((await postJson(`${root}/posts`, { title: "Invalid", text: "No", broadcast: "true" })).status, 400);
  const mentioned = createPost(db, swarm.id, "Maria", { title: "Attention", text: "@User a question" }, Date.now());
  const comment = addComment(db, swarm.id, "John", mentioned.id, "@user more evidence", Date.now()).comment;
  const detail = await getJson<PostDetailResponse>(`${root}/posts/${mentioned.id}`);
  assert.equal(detail.body.post.userSubscribed, false);
  assert.equal(detail.body.post.userUnreadComments, 2);
  const read = await postJson<UserCommentsReadResponse>(`${root}/posts/${mentioned.id}/read`, {
    commentIds: [comment.id],
  });
  assert.equal(read.body.updated, 2);
  assert.equal(read.body.userUnread.comments, 0);
  assert.equal(read.body.userSubscribed, false);
});

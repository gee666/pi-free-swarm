import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PostDetailResponse,
  PostListResponse,
  UserCommentsReadResponse,
  UserPostAttention,
} from "../../src/api-types.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { getJson, openSse, postJson, startTestBoard } from "./helpers.js";

test("User follow buttons have canonical HTTP state, preserve opt-out and hide rather than consume unseen comments", async (t) => {
  const clock = new FakeClock(T0);
  const board = await startTestBoard({ clock });
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Follow", text: "Explicit User subscription." }, T0);
  const base = `${board.base}/api/swarms/${swarm.id}/posts/${post.id}`;
  const endpoint = `${base}/subscription`;
  const stream = await openSse(`${board.base}/events?swarm=${swarm.id}`);
  t.after(() => stream.close());
  const initial = await getJson<UserPostAttention>(endpoint);
  assert.deepEqual(initial.body, {
    postId: post.id,
    userSubscribed: false,
    userUnreadComments: 0,
    userUnread: { messages: 0, comments: 0 },
  });
  assert.equal((await postJson<UserPostAttention>(endpoint, { subscribed: true })).body.userSubscribed, true);
  const first = addComment(db, swarm.id, "John", post.id, "retained unread", T0).comment;
  const list = await getJson<PostListResponse>(`${board.base}/api/swarms/${swarm.id}/posts`);
  assert.equal(list.body.posts.find((item) => item.id === post.id)?.userUnreadComments, 1);
  const left = await postJson<UserPostAttention>(endpoint, { subscribed: false });
  assert.deepEqual(left.body, {
    postId: post.id,
    userSubscribed: false,
    userUnreadComments: 0,
    userUnread: { messages: 0, comments: 0 },
  });
  clock.advance(EVENTS_TAIL_MS);
  const frame = await stream.next(
    ({ event }) =>
      event?.type === "user.post.updated" && event.payload.postId === post.id && !event.payload.userSubscribed,
  );
  assert.ok(frame.event?.type === "user.post.updated");
  assert.equal(frame.event.payload.userUnread.comments, 0);
  const retained = db.sql.prepare(`SELECT read_at FROM user_comment_attention WHERE comment_id = ?`).get(first.id);
  assert.equal(retained?.read_at, null);
  const hiddenRead = await postJson<UserCommentsReadResponse>(`${base}/read`, { commentIds: [first.id] });
  assert.equal(hiddenRead.body.updated, 0, "a late read mark while unfollowed is ignored atomically");
  assert.equal(hiddenRead.body.userSubscribed, false);
  addComment(db, swarm.id, "User", post.id, "commenting does not reverse explicit opt-out", T0);
  addComment(db, swarm.id, "Liam", post.id, "not backfilled later", T0);
  assert.equal((await getJson<UserPostAttention>(endpoint)).body.userSubscribed, false);
  const rejoined = await postJson<UserPostAttention>(endpoint, { subscribed: true });
  assert.equal(
    rejoined.body.userUnreadComments,
    1,
    "retained unread returns, but comments missed while unsubscribed are not backfilled",
  );
  addComment(db, swarm.id, "John", post.id, "future notification", T0);
  const detail = await getJson<PostDetailResponse>(base);
  assert.equal(detail.body.post.userSubscribed, true);
  assert.equal(detail.body.post.userUnreadComments, 2);
  const beforeRead = db.sql.prepare("SELECT MAX(id) AS id FROM events").get();
  assert.ok(beforeRead && typeof beforeRead.id === "number");
  const beforeReadId = beforeRead.id;
  await postJson(`${base}/read`, { commentIds: [first.id] });
  clock.advance(EVENTS_TAIL_MS);
  await stream.next(
    ({ id, event }) =>
      Number(id) > beforeReadId &&
      event?.type === "user.post.updated" &&
      event.payload.postId === post.id &&
      event.payload.userUnreadComments === 1,
  );
  const malformed = await postJson<{ field?: string }>(endpoint, { subscribed: "false" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.field, "subscribed");
  assert.equal(
    (await postJson(`${board.base}/api/swarms/${other.id}/posts/${post.id}/subscription`, { subscribed: false }))
      .status,
    404,
  );
  const final = await getJson<UserPostAttention>(endpoint);
  assert.equal(final.body.userSubscribed, true);
  assert.equal(final.body.userUnreadComments, 1);
});

test("User posting/commenting automatically publishes follow state after its visible wall record", async (t) => {
  const clock = new FakeClock(T0);
  const board = await startTestBoard({ clock });
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const stream = await openSse(`${board.base}/events?swarm=${swarm.id}`);
  t.after(() => stream.close());
  const post = createPost(board.temp.db, swarm.id, "User", { title: "My post", text: "Automatic follow." }, T0);
  const other = createPost(board.temp.db, swarm.id, "Maria", { title: "Joined post", text: "Comment to follow." }, T0);
  addComment(board.temp.db, swarm.id, "User", other.id, "joining", T0);
  clock.advance(EVENTS_TAIL_MS);
  const created = await stream.next(
    ({ event }) => event?.type === "user.post.updated" && event.payload.postId === post.id,
  );
  const joined = await stream.next(
    ({ event }) => event?.type === "user.post.updated" && event.payload.postId === other.id,
  );
  assert.ok(created.event?.type === "user.post.updated" && created.event.payload.userSubscribed);
  assert.ok(joined.event?.type === "user.post.updated" && joined.event.payload.userSubscribed);
  const createdIndex = stream.frames.findIndex(
    ({ event }) => event?.type === "post.created" && event.payload.post.id === post.id,
  );
  assert.ok(stream.frames.indexOf(created) > createdIndex);
  assert.equal(
    (await getJson<UserPostAttention>(`${board.base}/api/swarms/${swarm.id}/posts/${other.id}/subscription`)).body
      .userUnreadComments,
    0,
    "no self notifications",
  );
});

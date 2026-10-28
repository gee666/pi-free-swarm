import assert from "node:assert/strict";
import { test } from "node:test";
import type { SwarmDetailResponse, UserCommentsReadResponse } from "../../src/api-types.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { userUnreadSummary } from "../../src/store/user-unread.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { getJson, openSse, postJson, startTestBoard } from "./helpers.js";

test("User badge counts survive snapshots and live events without clearing unseen or other-swarm comments", async (t) => {
  const clock = new FakeClock(T0);
  const board = await startTestBoard({ clock });
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const stream = await openSse(`${board.base}/events?swarm=${swarm.id}`);
  t.after(() => stream.close());
  const post = createPost(db, swarm.id, "User", { title: "Mine", text: "Read a displayed snapshot." }, T0);
  const seen = addComment(db, swarm.id, "Maria", post.id, "displayed comment", T0).comment;
  const elsewhere = createPost(db, other.id, "User", { title: "Other", text: "Keep isolated." }, T0);
  addComment(db, other.id, "Maria", elsewhere.id, "foreign comment", T0);
  clock.advance(EVENTS_TAIL_MS);
  const created = await stream.next(
    ({ event }) => event?.type === "user.post.updated" && event.payload.userUnread.comments === 1,
  );
  assert.ok(created.event?.type === "user.post.updated");
  assert.deepEqual(created.event.payload.userUnread, { messages: 0, comments: 1 });
  const snapshot = await getJson<SwarmDetailResponse>(`${board.base}/api/swarms/${swarm.id}`);
  assert.deepEqual(snapshot.body.userUnread, { messages: 0, comments: 1 });
  await getJson(`${board.base}/api/swarms/${swarm.id}/posts/${post.id}`);
  assert.deepEqual(
    userUnreadSummary(db, swarm.id),
    { messages: 0, comments: 1 },
    "fetching alone never marks failed/unrendered content read",
  );
  addComment(db, swarm.id, "John", post.id, "arrived after displayed snapshot", T0 + 1);
  const read = await postJson<UserCommentsReadResponse>(`${board.base}/api/swarms/${swarm.id}/posts/${post.id}/read`, {
    commentIds: [seen.id],
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { updated: 1, userUnread: { messages: 0, comments: 1 }, userSubscribed: true });
  clock.advance(EVENTS_TAIL_MS);
  const status = await stream.next(
    ({ event }) =>
      event?.type === "user.post.updated" &&
      event.payload.userUnreadComments === 1 &&
      event.payload.userUnread.messages === 0,
  );
  assert.ok(status.event?.type === "user.post.updated");
  assert.deepEqual(status.event.payload.userUnread, { messages: 0, comments: 1 });
  assert.deepEqual(userUnreadSummary(db, swarm.id), { messages: 0, comments: 1 });
  assert.deepEqual(userUnreadSummary(db, other.id), { messages: 0, comments: 1 });
  assert.ok(
    stream.frames.every(
      ({ event }) =>
        !event || (event.type !== "message.created" && event.type !== "message.status") || event.swarmId === swarm.id,
    ),
  );
});

test("User comment read route rejects malformed controls and post/swarm mismatches", async (t) => {
  const board = await startTestBoard({ clock: new FakeClock(T0) });
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const other = seedSwarm(board.temp.db);
  const post = createPost(board.temp.db, swarm.id, "User", { title: "Input", text: "Keep bounds." }, T0);
  const comment = addComment(board.temp.db, swarm.id, "Maria", post.id, "unread", T0).comment;
  const endpoint = `${board.base}/api/swarms/${swarm.id}/posts/${post.id}/read`;
  assert.equal((await postJson(endpoint, { commentIds: [-1] })).status, 400);
  assert.equal((await postJson(endpoint, { commentIds: "all" })).status, 400);
  assert.equal((await postJson(endpoint, { commentIds: [comment.id], padding: "x".repeat(70_000) })).status, 400);
  assert.equal(
    (await postJson(`${board.base}/api/swarms/${other.id}/posts/${post.id}/read`, { commentIds: [comment.id] })).status,
    404,
  );
  assert.deepEqual(userUnreadSummary(board.temp.db, swarm.id), { messages: 0, comments: 1 });
  assert.deepEqual((await postJson<UserCommentsReadResponse>(endpoint, { commentIds: [] })).body, {
    updated: 0,
    userUnread: { messages: 0, comments: 1 },
    userSubscribed: true,
  });
});

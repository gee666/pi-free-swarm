import assert from "node:assert/strict";
import { test } from "node:test";
import type { WatcherChatResponse } from "../../src/api-types.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, startTestBoard } from "./helpers.js";

test("Watcher chat persists one wall conversation and notifies Watcher on every send", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const { id } = seedSwarm(db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${id}/watcher`;
  assert.deepEqual((await getJson<WatcherChatResponse>(url)).body, { conversation: null });
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM posts").get()?.n, 0);
  // A similarly named ordinary post must not become the chat.
  const ordinary = createPost(db, id, "User", { title: "Watcher chat", text: "Unrelated" }, Date.now());
  const first = await postJson<WatcherChatResponse>(url, { text: "What is happening?", author: "John" });
  assert.equal(first.status, 201);
  const conversation = first.body.conversation;
  assert.ok(conversation);
  assert.notEqual(conversation.post.id, ordinary.id);
  assert.equal(conversation.post.author, "User");
  assert.equal(conversation.post.text, "@Watcher\nWhat is happening?");
  assert.equal(conversation.post.broadcast, false);
  const reply = addComment(db, id, "Watcher", conversation.post.id, "Checking the recorded work.", Date.now());
  const second = await postJson<WatcherChatResponse>(url, { text: "Any blockers?" });
  assert.equal(second.body.conversation?.post.id, conversation.post.id);
  assert.deepEqual(
    second.body.conversation?.comments.map((comment) => comment.text),
    [reply.comment.text, "@Watcher\nAny blockers?"],
  );
  const recipients = db.sql.prepare("SELECT name FROM message_recipients ORDER BY message_id").all();
  assert.deepEqual(
    recipients.map((recipient) => recipient.name),
    ["Watcher", "Watcher"],
  );
  assert.deepEqual((await getJson<WatcherChatResponse>(url)).body, second.body);
  const other = seedSwarm(db, { now: Date.now() + 1, name: "Other" });
  assert.equal(
    (await getJson<WatcherChatResponse>(`${board.base}/api/swarms/${other.id}/watcher`)).body.conversation,
    null,
  );
});

test("Watcher chat accepts queued input on stopped and finished swarms without starting a runtime", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const { id } = seedSwarm(db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${id}/watcher`;
  for (const status of ["stopped", "finished"]) {
    db.sql.prepare("UPDATE swarms SET status = ? WHERE id = ?").run(status, id);
    assert.equal((await postJson(url, { text: `Question while ${status}` })).status, 201);
    assert.equal(db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(id)?.status, status);
    assert.equal(
      db.sql.prepare("SELECT status FROM participants WHERE swarm_id = ? AND name = 'Watcher'").get(id)?.status,
      "pending",
    );
  }
});

test("Watcher chat returns the entire history beyond normal page sizes", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const { id } = seedSwarm(db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${id}/watcher`;
  const first = await postJson<WatcherChatResponse>(url, { text: "Start" });
  const postId = first.body.conversation?.post.id;
  assert.ok(postId);
  for (let index = 0; index < 125; index++) addComment(db, id, "Watcher", postId, `Reply ${index}`, Date.now() + index);
  const saved = (await getJson<WatcherChatResponse>(url)).body.conversation;
  assert.equal(saved?.comments.length, 125);
  assert.equal(saved?.comments[0].text, "Reply 0");
  assert.equal(saved?.comments.at(-1)?.text, "Reply 124");
});

test("Watcher chat validates input and missing swarms without creating a conversation", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { id } = seedSwarm(board.temp.db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${id}/watcher`;
  for (const body of [{}, { text: 42 }, { text: "  \n" }]) assert.equal((await postJson(url, body)).status, 400);
  assert.equal((await postJson(url, { text: "Question" }, "text/plain")).status, 400);
  assert.equal((await getJson<WatcherChatResponse>(url)).body.conversation, null);
  assert.equal((await getJson(`${board.base}/api/swarms/9999/watcher`)).status, 404);
  assert.equal((await postJson(`${board.base}/api/swarms/9999/watcher`, { text: "Question" })).status, 404);
});

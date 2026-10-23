import assert from "node:assert/strict";
import { it } from "node:test";
import type { MailboxResponse } from "../../src/api-types.js";
import { markRead } from "../../src/broker/delivery-state.js";
import { replyToThread, sendMessage } from "../../src/broker/messages.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

it("filters unread User threads before pagination, including beyond the first unfiltered page", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db, { now: Date.now() });
  const now = Date.now();
  const first = sendMessage(db, swarm.id, "Maria", ["User"], "old unread one", now);
  const second = sendMessage(db, swarm.id, "John", ["User"], "old unread two", now + 1);
  for (let index = 0; index < 25; index++) {
    const message = sendMessage(db, swarm.id, "Maria", ["User"], `new read ${index}`, now + 2 + index);
    markRead(db, swarm.id, "User", [message.id], now + 100);
  }
  const route = `${board.base}/api/swarms/${swarm.id}/participants/User/messages`;
  const all = await getJson<MailboxResponse>(route);
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 27);
  assert.equal(all.body.threads.length, 20);
  assert.equal(
    all.body.threads.some((thread) => [first.threadId, second.threadId].includes(thread.thread.id)),
    false,
  );
  const filtered = await getJson<MailboxResponse>(`${route}?unreadOnly=true&count=1`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.unreadOnly, true);
  assert.equal(filtered.body.total, 2);
  assert.equal(filtered.body.unread, 2);
  assert.equal(filtered.body.threads[0].thread.id, second.threadId);
  const next = await getJson<MailboxResponse>(`${route}?unreadOnly=true&count=1&offset=1`);
  assert.equal(next.body.total, 2);
  assert.equal(next.body.threads[0].thread.id, first.threadId);
  assert.equal((await getJson<MailboxResponse>(`${route}?unreadOnly=false`)).body.total, 27);
});

it("keeps full inbox context in an unread thread and removes it only after its unread messages are read", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db, { now: Date.now() });
  const now = Date.now();
  const first = sendMessage(db, swarm.id, "Maria", ["User"], "read context", now);
  markRead(db, swarm.id, "User", [first.id], now + 1);
  const latest = replyToThread(db, swarm.id, "Maria", first.threadId, "unread follow-up", now + 2);
  const route = `${board.base}/api/swarms/${swarm.id}/participants/User/messages?unreadOnly=true`;
  const filtered = await getJson<MailboxResponse>(route);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.threads[0].unread, 1);
  assert.deepEqual(
    filtered.body.threads[0].messages.map((message) => message.text),
    ["read context", "unread follow-up"],
  );
  markRead(db, swarm.id, "User", [latest.id], now + 3);
  const read = await getJson<MailboxResponse>(route);
  assert.equal(read.body.total, 0);
  assert.equal(read.body.unread, 0);
  assert.deepEqual(read.body.threads, []);
  const all = await getJson<MailboxResponse>(route.replace("?unreadOnly=true", ""));
  assert.equal(all.body.total, 1);
});

it("rejects unread-only filtering outside the User inbox and rejects malformed controls", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const base = `${board.base}/api/swarms/${swarm.id}/participants`;
  for (const suffix of [
    "/Maria/messages?unreadOnly=true",
    "/User/messages?box=sent&unreadOnly=true",
    "/User/messages?unreadOnly=maybe",
  ]) {
    assert.equal((await getJson(`${base}${suffix}`)).status, 400, suffix);
  }
  assert.equal((await getJson(`${base}/Maria/messages`)).status, 200);
  assert.equal((await getJson(`${base}/User/messages?box=sent`)).status, 200);
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SendMessageResponse, ThreadResponse, WatcherResponse } from "../../src/api-types.js";
import { replyToThread } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { WATCHER_NAME } from "../../src/constants.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, startTestBoard } from "./helpers.js";

it("uses one User/Watcher thread, exposes replies, and queues questions after the run", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${swarm.id}/watcher`;
  assert.equal((await getJson(url)).body, null);
  const first = await postJson<SendMessageResponse>(url, { text: "What is Maria doing?" });
  assert.equal(first.status, 201);
  assert.deepEqual(
    first.body.message.recipients.map((recipient) => recipient.name),
    [WATCHER_NAME],
  );
  replyToThread(
    board.temp.db,
    swarm.id,
    WATCHER_NAME,
    first.body.message.threadId,
    "Maria is designing login.",
    Date.now(),
  );
  const second = await postJson<SendMessageResponse>(url, { text: "Any blockers?" });
  assert.equal(second.body.message.threadId, first.body.message.threadId);
  const chat = await getJson<ThreadResponse>(url);
  assert.deepEqual(chat.body.thread.members, ["User", WATCHER_NAME]);
  assert.equal(chat.body.messages.length, 3);
  endRun(board.temp.db, swarm.id, process.pid, "finished", Date.now());
  const queued = await postJson<SendMessageResponse>(url, { text: "What did they finish?" });
  assert.equal(queued.status, 201);
  assert.equal(queued.body.message.recipients[0].status, "pending");
  assert.equal((await postJson(url, { text: "" })).status, 400);
  assert.equal((await getJson(`${board.base}/api/swarms/999/watcher`)).status, 404);
});

it("surfaces an unanswered Watcher session fallback after schema-mismatch tool failures without replaying writes", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const url = `${board.base}/api/swarms/${swarm.id}/watcher`;
  const question = (await postJson<SendMessageResponse>(url, { text: "Who leads?" })).body.message;
  const watcher = listAgentSessions(board.temp.db, swarm.id).find((agent) => agent.name === WATCHER_NAME);
  assert.ok(watcher);
  mkdirSync(path.dirname(watcher.sessionFile), { recursive: true });
  const failure = "swarm.db schema v8 is newer than this extension (v4). Update pi-free-swarm.";
  const answer = "My monitoring and thread reply failed because the running extension is older than the database.";
  const entries = [
    {
      role: "user",
      content: `[swarm message #${question.id}] thread #${question.threadId} · from User\n\"Who leads?\"`,
    },
    { role: "toolResult", toolCallId: "failed-reply", toolName: "swarm_reply_to", content: failure, isError: true },
    { role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop" },
  ];
  writeFileSync(
    watcher.sessionFile,
    entries
      .map((message, index) =>
        JSON.stringify({
          type: "message",
          id: String(index),
          timestamp: new Date().toISOString(),
          message,
        }),
      )
      .join("\n") + "\n",
  );
  const chat = (await getJson<WatcherResponse>(url)).body;
  assert.deepEqual(chat.fallback, { questionId: question.id, text: answer, error: failure });
  assert.equal(chat.messages.length, 1);
  replyToThread(board.temp.db, swarm.id, WATCHER_NAME, question.threadId, "Durable answer", Date.now());
  assert.equal((await getJson<WatcherResponse>(url)).body.fallback, undefined);
  await postJson(url, { text: "Another question" });
  assert.equal((await getJson<WatcherResponse>(url)).body.fallback, undefined);
});

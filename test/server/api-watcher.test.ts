import assert from "node:assert/strict";
import { it } from "node:test";
import type { SendMessageResponse, ThreadResponse } from "../../src/api-types.js";
import { replyToThread } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { WATCHER_NAME } from "../../src/constants.js";
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

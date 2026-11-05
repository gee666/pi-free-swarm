import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { WatcherChatResponse } from "../../src/api-types.js";
import { createPost } from "../../src/broker/wall.js";
import { WATCHER_READONLY_TOOLS } from "../../src/constants.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, openSse, isType } from "./helpers.js";
import { watcherBoard } from "./watcher-chat-fixture.js";

test("private Watcher chat answers stopped swarms using its configured model and readonly tools", async (t) => {
  const board = await watcherBoard(t);
  const { db } = board.temp;
  db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(board.swarm.id);
  const ordinary = createPost(db, board.swarm.id, "User", { title: "Watcher chat", text: "Unrelated" }, Date.now());
  const participant = board.watcher();
  assert.deepEqual((await getJson(board.url)).body, { sessionId: null, messages: [], status: "idle", error: null });
  const stream = await openSse(`${board.base}/events?swarm=${board.swarm.id}`);
  t.after(() => stream.close());
  const sent = await postJson<WatcherChatResponse>(board.url, { text: "What is happening?", sessionId: null });
  assert.equal(sent.status, 202);
  assert.equal(sent.body.status, "working");
  assert.deepEqual(
    sent.body.messages.map((m) => [m.role, m.text]),
    [["user", "What is happening?"]],
  );
  const answered = await board.done();
  assert.equal(answered.status, "idle");
  assert.equal(answered.error, null);
  assert.deepEqual(
    answered.messages.map((m) => [m.role, m.text]),
    [
      ["user", "What is happening?"],
      ["assistant", "Recorded answer"],
    ],
  );
  const event = await stream.next(isType("watcher.chat.updated"));
  assert.deepEqual(event.event?.payload, { swarmId: board.swarm.id });
  assert.deepEqual(board.watcher(), participant);
  assert.equal(db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(board.swarm.id)?.status, "stopped");
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM posts").get()?.n, 1);
  assert.equal(db.sql.prepare("SELECT id FROM posts").get()?.id, ordinary.id);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments").get()?.n, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM message_recipients").get()?.n, 0);
  assert.equal(db.sql.prepare("SELECT cost FROM usage WHERE agent = 'Watcher'").get()?.cost, 0.01);
  const started = board.fake.log().find((row) => row.fake === "spawn");
  assert.ok(started);
  const args = started.argv;
  assert.ok(Array.isArray(args));
  assert.equal(args[args.indexOf("--model") + 1], "watcher-provider/watcher-model");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  assert.equal(args[args.indexOf("--tools") + 1], WATCHER_READONLY_TOOLS.join(","));
  assert.ok(args.includes("--no-context-files"));
  const session = args[args.indexOf("--session") + 1];
  assert.equal(typeof session, "string");
  assert.ok(String(session).includes("/watcher-chat/"));
  const prompt = String(args[args.indexOf("--append-system-prompt") + 1]);
  assert.match(readFileSync(prompt, "utf8"), /Answer the user directly/);
  assert.equal((await postJson(board.url, { text: "Follow up", sessionId: answered.sessionId })).status, 202);
  assert.equal((await board.done()).messages.length, 4);
  assert.equal(board.fake.log().filter((row) => row.fake === "spawn").length, 1);
});

test("New is lazy, retains old session files and cancels a busy chat without changing workers", async (t) => {
  const board = await watcherBoard(t, { runs: [[{ type: "silence" }]] });
  const participant = board.watcher();
  const initial = await postJson<WatcherChatResponse>(board.url + "/new", {});
  assert.equal(initial.status, 201);
  assert.ok(initial.body.sessionId);
  assert.deepEqual(initial.body.messages, []);
  assert.equal(board.fake.log().length, 0);
  const sent = await postJson<WatcherChatResponse>(board.url, {
    text: "Old question",
    sessionId: initial.body.sessionId,
  });
  assert.equal(sent.status, 202);
  assert.equal((await postJson(board.url, { text: "While busy", sessionId: initial.body.sessionId })).status, 409);
  const fresh = await postJson<WatcherChatResponse>(board.url + "/new", {});
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.sessionId, initial.body.sessionId);
  assert.deepEqual(fresh.body.messages, []);
  assert.equal(fresh.body.status, "idle");
  assert.deepEqual(board.watcher(), participant);
  const oldFile = path.join(
    board.temp.db.dataDir,
    "sessions",
    String(board.swarm.id),
    "watcher-chat",
    String(initial.body.sessionId),
    "session.jsonl",
  );
  assert.ok(existsSync(oldFile));
  const freshFile = path.join(path.dirname(path.dirname(oldFile)), String(fresh.body.sessionId), "session.jsonl");
  const native = SessionManager.open(freshFile);
  assert.equal(native.getSessionId(), fresh.body.sessionId);
  assert.deepEqual(native.buildSessionContext().messages, []);
  assert.equal(SessionManager.open(oldFile).getSessionId(), initial.body.sessionId);
  assert.equal(board.temp.db.sql.prepare("SELECT COUNT(*) AS n FROM watcher_chat_sessions").get()?.n, 2);
  assert.equal(
    (await postJson(board.url, { text: "Late old request", sessionId: initial.body.sessionId })).status,
    409,
  );
  assert.equal((await postJson(board.url, { text: "Late initial request", sessionId: null })).status, 409);
  assert.deepEqual((await getJson<WatcherChatResponse>(board.url)).body, fresh.body);
});

test("chat validates requests, isolates swarms and preserves receipt on startup failure", async (t) => {
  const board = await watcherBoard(t, { startup: [{ type: "exit", code: 1, stderr: "startup failed" }] });
  for (const body of [{}, { text: 42 }, { text: "  \n" }, { text: "Hi", sessionId: 42 }])
    assert.equal((await postJson(board.url, body)).status, 400);
  assert.equal((await postJson(board.url, { text: "Question" }, "text/plain")).status, 400);
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded"])
    assert.equal((await postJson(board.url + "/new", {}, contentType)).status, 400);
  assert.equal(board.snapshot().sessionId, null);
  const sent = await postJson(board.url, { text: "Remember my question", sessionId: null });
  assert.equal(sent.status, 202);
  const failed = await board.done();
  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /exited/);
  assert.equal(failed.messages[0]?.text, "Remember my question");
  const other = seedSwarm(board.temp.db, { name: "Other", now: Date.now() + 1 });
  assert.equal(
    (await getJson<WatcherChatResponse>(`${board.base}/api/swarms/${other.id}/watcher`)).body.sessionId,
    null,
  );
  for (const suffix of ["", "/new"])
    assert.equal((await postJson(`${board.base}/api/swarms/9999/watcher${suffix}`, { text: "Question" })).status, 404);
});

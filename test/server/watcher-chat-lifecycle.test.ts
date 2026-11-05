import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { WatcherChatService } from "../../src/broker/watcher-chat.js";
import { systemClock } from "../../src/clock.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { postJson, waitFor } from "./helpers.js";
import { watcherBoard } from "./watcher-chat-fixture.js";

test("legacy run recovers actual Watcher model and thinking from native session metadata", async (t) => {
  const board = await watcherBoard(t);
  const { db } = board.temp;
  db.sql.prepare("UPDATE run_configurations SET configuration = json_remove(configuration, '$.watcher')").run();
  const watcher = listAgentSessions(db, board.swarm.id).find((agent) => agent.name === "Watcher");
  assert.ok(watcher);
  mkdirSync(path.dirname(watcher.sessionFile), { recursive: true });
  writeFileSync(
    watcher.sessionFile,
    [
      { type: "session", version: 3, id: "legacy", timestamp: new Date().toISOString(), cwd: board.temp.cwd },
      { type: "model_change", provider: "previous", modelId: "old" },
      { type: "thinking_level_change", thinkingLevel: "off" },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Do not inject this transcript into chat prompt" }],
        },
      },
      { type: "model_change", provider: "recorded-provider", modelId: "recorded-model" },
      { type: "thinking_level_change", thinkingLevel: "high" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  await postJson(board.url, { text: "Legacy question", sessionId: null });
  assert.equal((await board.done()).status, "idle");
  const args = board.fake.log().find((row) => row.fake === "spawn")?.argv;
  assert.ok(Array.isArray(args));
  assert.equal(args[args.indexOf("--model") + 1], "recorded-provider/recorded-model");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  assert.equal(board.snapshot().messages.length, 2);
});

test("missing recorded Watcher model fails visibly without selecting a worker or calling Pi", async (t) => {
  const board = await watcherBoard(t);
  board.temp.db.sql
    .prepare("UPDATE run_configurations SET configuration = json_remove(configuration, '$.watcher')")
    .run();
  await postJson(board.url, { text: "Question", sessionId: null });
  const chat = await board.done();
  assert.equal(chat.status, "error");
  assert.match(chat.error ?? "", /No recorded Watcher model/);
  assert.equal(chat.messages[0]?.text, "Question");
  assert.equal(board.fake.log().length, 0);
});

test("board-scoped shutdown kills chat process and another service resumes its persisted private session", async (t) => {
  const board = await watcherBoard(t);
  await postJson(board.url, { text: "First", sessionId: null });
  const before = await board.done();
  const pid = board.fake.log().find((row) => row.fake === "spawn")?.pid;
  assert.equal(typeof pid, "number");
  await board.chat.close();
  if (typeof pid === "number") assert.throws(() => process.kill(pid, 0));
  await assert.rejects(() => board.chat.send(board.swarm.id, "Not accepted"), /shutting down/);
  const restored = new WatcherChatService(board.temp.db, systemClock);
  t.after(() => restored.close());
  assert.deepEqual(restored.snapshot(board.swarm.id), before);
  const receipt = await restored.send(board.swarm.id, "Second", before.sessionId);
  assert.equal(receipt.status, "working");
  await waitFor(() => restored.snapshot(board.swarm.id).status === "idle" || null);
  assert.equal(restored.snapshot(board.swarm.id).messages.length, 4);
  const starts = board.fake.log().filter((row) => row.fake === "spawn");
  assert.equal(starts.length, 2);
  const files = starts.map((row) => {
    const args = row.argv;
    assert.ok(Array.isArray(args));
    return args[args.indexOf("--session") + 1];
  });
  assert.equal(files[0], files[1]);
  await restored.close();
});

test("money budget blocks private chat before spending but never stops workers", async (t) => {
  const board = await watcherBoard(t);
  const { db } = board.temp;
  db.sql
    .prepare("UPDATE run_configurations SET configuration = json_set(configuration, '$.budget.moneyUsd', 0.005)")
    .run();
  const participant = board.watcher();
  await postJson(board.url, { text: "One paid answer", sessionId: null });
  const spent = await board.done();
  assert.equal(spent.status, "error");
  assert.match(spent.error ?? "", /money budget is exhausted/);
  assert.equal(db.sql.prepare("SELECT SUM(cost) AS n FROM usage").get()?.n, 0.01);
  assert.deepEqual(board.watcher(), participant);
  const starts = board.fake.log().filter((row) => row.fake === "spawn").length;
  await postJson(board.url, { text: "Do not spend", sessionId: spent.sessionId });
  assert.match((await board.done()).error ?? "", /money budget is exhausted/);
  assert.equal(board.fake.log().filter((row) => row.fake === "spawn").length, starts);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM budget_stops").get()?.n, 0);
});

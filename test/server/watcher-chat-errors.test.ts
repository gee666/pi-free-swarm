import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import type { WatcherChatResponse } from "../../src/api-types.js";
import { PI_ARGS_PREFIX_ENV, SETTINGS_FILE } from "../../src/constants.js";
import { postJson, waitFor } from "./helpers.js";
import { watcherBoard } from "./watcher-chat-fixture.js";

async function errorBoard(t: TestContext, mode: string, holdClose = false) {
  let release = () => undefined;
  t.after(() => release());
  const board = await watcherBoard(t);
  process.env[PI_ARGS_PREFIX_ENV] = JSON.stringify([
    fileURLToPath(new URL("../fixtures/watcher-chat-pi.ts", import.meta.url)),
  ]);
  const gate = path.join(board.temp.cwd, "close-gate");
  writeFileSync(
    path.join(board.temp.db.dataDir, SETTINGS_FILE),
    JSON.stringify({
      env: { ...board.fake.env, FAKE_CHAT_MODE: mode, ...(holdClose ? { FAKE_CHAT_CLOSE_GATE: gate } : {}) },
    }),
  );
  release = () => {
    if (!existsSync(board.temp.cwd)) return;
    writeFileSync(gate, "");
  };
  return { ...board, release };
}

for (const reason of ["error", "aborted", "empty"]) {
  test(`Watcher ${reason} response is observable and keeps the user receipt`, async (t) => {
    const board = await errorBoard(t, reason);
    assert.equal((await postJson(board.url, { text: "Question", sessionId: null })).status, 202);
    const chat = await board.done();
    assert.equal(chat.status, "error");
    assert.match(chat.error ?? "", reason === "empty" ? /no text/ : /Provider unavailable/);
    assert.deepEqual(
      chat.messages.map((m) => m.role),
      ["user"],
    );
  });
}

test("thinking and tool-use text are not chat replies or duplicates", async (t) => {
  const board = await errorBoard(t, "toolThenText");
  await postJson(board.url, { text: "Question", sessionId: null });
  const chat = await board.done();
  assert.equal(chat.status, "idle");
  assert.deepEqual(
    chat.messages.map((m) => m.text),
    ["Question", "Final answer"],
  );
});

test("New fences old output and status while recording closing usage", async (t) => {
  const board = await errorBoard(t, "hang", true);
  await postJson(board.url, { text: "Old question", sessionId: null });
  await waitFor(() => board.fake.log().some((row) => row.type === "prompt") || null);
  const previous = board.snapshot().sessionId;
  const resetting = postJson<WatcherChatResponse>(board.url + "/new", {});
  await waitFor(() => board.fake.log().some((row) => row.fake === "signal") || null);
  board.release();
  const fresh = await resetting;
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.sessionId, previous);
  assert.deepEqual(fresh.body.messages, []);
  assert.equal(fresh.body.status, "idle");
  assert.equal(
    board.temp.db.sql.prepare("SELECT SUM(cost) AS cost FROM usage WHERE agent = 'Watcher'").get()?.cost,
    0.02,
  );
});

test("immediate retry acknowledges promptly but never overlaps old same-session process cleanup", async (t) => {
  const board = await errorBoard(t, "reject", true);
  await postJson(board.url, { text: "First", sessionId: null });
  const failed = await board.done();
  assert.equal(failed.status, "error");
  await waitFor(() => board.fake.log().some((row) => row.fake === "signal") || null);
  const retry = await postJson<WatcherChatResponse>(board.url, { text: "Retry", sessionId: failed.sessionId });
  assert.equal(retry.status, 202);
  assert.equal(retry.body.status, "working");
  assert.equal(retry.body.messages.at(-1)?.text, "Retry");
  assert.equal(board.fake.log().filter((row) => row.fake === "spawn").length, 1);
  board.release();
  await board.done();
  const log = board.fake.log();
  const exit = log.findIndex((row) => row.fake === "exit");
  const second = log.findIndex((row, index) => index > 0 && row.fake === "spawn");
  assert.ok(exit >= 0 && second > exit);
});

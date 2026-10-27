import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { it } from "node:test";
import type { CreateCommentResponse, CreatePostResponse, SendMessageResponse } from "../../src/api-types.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { postJson, startTestBoard, type TestBoard } from "./helpers.js";

const text = "🙂漢字".repeat(30_000) + "\nfull-original-tail";

function assertAttachment(board: TestBoard, stored: string, original: string): string {
  assert.ok(
    stored.startsWith(Array.from(original).slice(0, 200).join("")),
    "all first 200 Unicode code points remain visible",
  );
  assert.equal(stored.includes("\uFFFD"), false, "preview does not split a Unicode sequence");
  const match = /\[full text: ([^\]]+)\]/u.exec(stored);
  assert.ok(match, "visible message points to the complete attachment");
  const relative = match[1];
  assert.ok(relative);
  const absolute = path.resolve(board.temp.cwd, relative);
  assert.ok(absolute.startsWith(board.temp.db.dataDir + path.sep), "attachment stays inside swarm data");
  const saved = readFileSync(absolute, "utf8");
  assert.ok(
    saved === original || saved === `${original}\n`,
    "attachment preserves the exact original, optionally adding one newline",
  );
  assert.equal(stored.includes("full-original-tail"), false, "long tail is not injected inline");
  return absolute;
}

it("accepts User text beyond the old request ceiling on every text channel without changing title rules", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  writeFileSync(path.join(board.temp.db.dataDir, "settings.json"), JSON.stringify({}));
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const url = (suffix: string) => `${board.base}/api/swarms/${swarm.id}${suffix}`;
  const files = new Set<string>();

  const post = await postJson<CreatePostResponse>(url("/posts"), { title: "Long User input", text, author: "Maria" });
  assert.equal(post.status, 201);
  assert.equal(post.body.post.author, "User");
  files.add(assertAttachment(board, post.body.post.text, text));

  const comment = await postJson<CreateCommentResponse>(url(`/posts/${post.body.post.id}/comments`), { text });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.comment.author, "User");
  files.add(assertAttachment(board, comment.body.comment.text, text));

  const message = await postJson<SendMessageResponse>(url("/messages"), { to: ["Maria"], text, sender: "Maria" });
  assert.equal(message.status, 201);
  assert.equal(message.body.message.sender, "User");
  files.add(assertAttachment(board, message.body.message.text, text));

  const reply = await postJson<SendMessageResponse>(url(`/threads/${message.body.message.threadId}/reply`), { text });
  assert.equal(reply.status, 201);
  files.add(assertAttachment(board, reply.body.message.text, text));

  const watcher = await postJson<SendMessageResponse>(url("/watcher"), { text });
  assert.equal(watcher.status, 201);
  assert.equal(watcher.body.message.sender, "User");
  files.add(assertAttachment(board, watcher.body.message.text, text));
  assert.equal(files.size, 5, "independent body IDs do not overwrite another channel's attachment");

  const invalidTitle = await postJson(url("/posts"), { title: "x".repeat(61), text });
  assert.equal(invalidTitle.status, 400);
  const invalidText = await postJson(url("/messages"), { to: ["Maria"], text: [text] });
  assert.equal(invalidText.status, 400);
});

it("accepts chunked User text beyond 64 KiB and preserves the Unicode tail", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const endpoint = `${board.base}/api/swarms/${swarm.id}/messages`;
  const payload = Buffer.from(JSON.stringify({ to: ["Maria"], text }), "utf8");
  const received = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    // Split inside the first multibyte character as well as beyond the former request cap.
    const split = payload.indexOf(Buffer.from("🙂", "utf8")) + 1;
    req.write(payload.subarray(0, split));
    req.write(payload.subarray(split, 70_000));
    req.end(payload.subarray(70_000));
  });
  assert.equal(received.status, 201);
  const message = board.temp.db.sql
    .prepare("SELECT body FROM messages WHERE swarm_id = ? ORDER BY id DESC LIMIT 1")
    .get(swarm.id);
  assert.ok(message);
  assertAttachment(board, String(message.body), text);
});

it("preserves leading and trailing whitespace in long User originals", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const original = "\n  leading space " + "🙂".repeat(250) + " trailing space \n\n";
  const response = await postJson<SendMessageResponse>(`${board.base}/api/swarms/${swarm.id}/messages`, {
    to: ["Maria"],
    text: original,
  });
  assert.equal(response.status, 201);
  assertAttachment(board, response.body.message.text, original);
});

it("keeps short User text inline and retains the cap on non-text control requests", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const root = `${board.base}/api/swarms/${swarm.id}`;
  const short = await postJson<SendMessageResponse>(`${root}/messages`, { to: ["Maria"], text: "🙂".repeat(200) });
  assert.equal(short.status, 201);
  assert.equal(short.body.message.text, "🙂".repeat(200));
  const oversizedControl = await postJson(`${root}/participants/User/read`, {
    messageIds: [],
    padding: "x".repeat(70_000),
  });
  assert.equal(oversizedControl.status, 400);
});

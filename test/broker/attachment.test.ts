import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { replyToThread, sendMessage } from "../../src/broker/messages.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { charCount } from "../../src/limits.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db, cwd } = temp;
const CEILING = 400;

function expectAttached(body: string, full: string, relative: string): void {
  const suffix = `… [full text: ${relative}]`;
  assert.ok(body.endsWith(` ${suffix}`), body);
  assert.equal(charCount(body), CEILING);
  assert.ok(full.startsWith(body.slice(0, body.length - suffix.length - 1)));
  assert.equal(readFileSync(path.join(cwd, relative), "utf8"), `${full}\n`);
}

it("stores bodies up to twice the stated limit as-is", () => {
  const swarm = seedSwarm(db);
  const body = "😀".repeat(CEILING);
  const post = createPost(db, swarm.id, "Maria", { title: "edge", text: body }, T0);
  assert.equal(post.text, body);
  assert.equal(addComment(db, swarm.id, "John", post.id, body, T0).comment.text, body);
  assert.equal(sendMessage(db, swarm.id, "Maria", ["John"], body, T0).text, body);
});

it("moves over-ceiling posts, comments and messages to a file instead of rejecting them", () => {
  const swarm = seedSwarm(db);
  const dir = `.pi/swarm/attachments/${swarm.id}`;
  const long = `${"word ".repeat(200)}end`;
  const post = createPost(db, swarm.id, "Maria", { title: "contract", text: long }, T0);
  expectAttached(post.text, long, `${dir}/post-${post.id}.md`);
  const { comment } = addComment(db, swarm.id, "John", post.id, `${long}!`, T0);
  expectAttached(comment.text, `${long}!`, `${dir}/comment-${comment.id}.md`);
  const message = sendMessage(db, swarm.id, "Maria", ["John"], long, T0);
  expectAttached(message.text, long, `${dir}/message-${message.id}.md`);
  const reply = replyToThread(db, swarm.id, "John", message.threadId, `${long}?`, T0);
  expectAttached(reply.text, `${long}?`, `${dir}/message-${reply.id}.md`);
});

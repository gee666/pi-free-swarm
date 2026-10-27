import { continueConversation } from "../helpers/conversation.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { USER_BODY_PREVIEW_CHARS } from "../../src/limits.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

const temps: TempDb[] = [];
afterEach(() => {
  for (const temp of temps.splice(0)) temp.cleanup();
});
function setup() {
  const temp = createTempDb();
  temps.push(temp);
  return { ...temp, swarm: seedSwarm(temp.db) };
}
function verify(body: string, raw: string, cwd: string, relative: string) {
  const head = Array.from(raw).slice(0, USER_BODY_PREVIEW_CHARS).join("");
  assert.equal(body, `${head} … [full text: ${relative}]`);
  assert.equal(readFileSync(path.join(cwd, relative), "utf8"), raw);
}

test("all User body channels preserve large originals and show exactly the first 200 Unicode points", () => {
  const { db, cwd, swarm } = setup();
  const raw = ` \n${"😀界".repeat(120)}${"large user input\n".repeat(12_000)}  \n`;
  const dir = `.pi/swarm/attachments/${swarm.id}`;
  const post = createPost(db, swarm.id, "User", { title: "User evidence", text: raw }, T0);
  verify(post.text, raw, cwd, `${dir}/post-${post.id}.md`);
  const { comment } = addComment(db, swarm.id, "User", post.id, raw, T0);
  verify(comment.text, raw, cwd, `${dir}/comment-${comment.id}.md`);
  const message = sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: raw, now: T0 });
  verify(message.text, raw, cwd, `${dir}/message-${message.id}.md`);
  const reply = continueConversation(db, swarm.id, "User", message.threadId, raw, T0);
  verify(reply.text, raw, cwd, `${dir}/message-${reply.id}.md`);
});

test("200 Unicode points stay inline while point 201 attaches only for User", () => {
  const { db, cwd, swarm } = setup();
  const boundary = "😀".repeat(USER_BODY_PREVIEW_CHARS);
  assert.equal(
    sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: boundary, now: T0 }).text,
    boundary,
  );
  const longer = boundary + "界";
  const user = sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: longer, now: T0 });
  verify(user.text, longer, cwd, `.pi/swarm/attachments/${swarm.id}/message-${user.id}.md`);
  assert.equal(sendMessage(db, { swarmId: swarm.id, from: "Maria", to: "John", text: longer, now: T0 }).text, longer);
  assert.equal(createPost(db, swarm.id, "John", { title: "Worker policy", text: longer }, T0).text, longer);
});

test("blank User bodies reject without files and short bodies retain legacy normalization", () => {
  const { db, cwd, swarm } = setup();
  assert.throws(
    () => sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: " \n ".repeat(1000), now: T0 }),
    /empty/,
  );
  assert.equal(existsSync(path.join(cwd, ".pi/swarm/attachments")), false);
  assert.equal(
    sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: "  short  ", now: T0 }).text,
    "short",
  );
});

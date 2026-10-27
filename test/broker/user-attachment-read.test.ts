import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { afterEach, test } from "node:test";
import { attachmentLocation } from "../../src/broker/attachment.js";
import { sendMessage } from "../../src/broker/messages.js";
import { hasUserAttachment, readUserAttachmentChunk } from "../../src/broker/user-attachment.js";
import { createPost } from "../../src/broker/wall.js";
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

test("bounded byte ranges preserve Unicode, BOM and whitespace without materializing the entire file", () => {
  const { db, swarm } = setup();
  const raw = `\uFEFF \n${"😀界e\u0301".repeat(80)} \n`;
  const message = sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: raw, now: T0 });
  let offset = 0;
  let restored = "";
  for (;;) {
    const chunk = readUserAttachmentChunk(db, swarm.id, "message", message.id, offset, 5);
    assert.ok(chunk);
    assert.ok(Buffer.byteLength(chunk.text) <= 5);
    restored += chunk.text;
    if (chunk.nextOffset === null) break;
    assert.ok(chunk.nextOffset > offset && chunk.nextOffset <= offset + 5);
    offset = chunk.nextOffset;
  }
  assert.equal(restored, raw);
});

test("only known generated User attachments in the selected swarm can replace stored text", () => {
  const { db, swarm } = setup();
  const user = createPost(db, swarm.id, "User", { title: "User", text: "x".repeat(300) }, T0);
  const worker = createPost(db, swarm.id, "Maria", { title: "Worker", text: "x".repeat(500) }, T0);
  const other = seedSwarm(db);
  assert.equal(readUserAttachmentChunk(db, other.id, "post", user.id, 0, 3000), null);
  assert.equal(readUserAttachmentChunk(db, swarm.id, "post", worker.id, 0, 3000), null);
  db.sql
    .prepare("UPDATE posts SET body = ? WHERE id = ?")
    .run("x".repeat(200) + " … [full text: ../../private.txt]", user.id);
  assert.equal(readUserAttachmentChunk(db, swarm.id, "post", user.id, 0, 3000), null);
});

test("missing generated content and malformed byte positions fail rather than report completeness", () => {
  const { db, swarm } = setup();
  const message = sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: "😀".repeat(300), now: T0 });
  assert.throws(() => readUserAttachmentChunk(db, swarm.id, "message", message.id, 1, 3000), /not valid UTF-8/);
  assert.throws(() => readUserAttachmentChunk(db, swarm.id, "message", message.id, 2000, 3000), /beyond the file/);
  assert.throws(() => readUserAttachmentChunk(db, swarm.id, "message", message.id, 0, 3), /at least 4 bytes/);
  unlinkSync(attachmentLocation(db, swarm.id, "message", message.id).absolute);
  assert.equal(
    hasUserAttachment(db, swarm.id, "message", message.id),
    true,
    "classification does not read missing files",
  );
  assert.throws(
    () => readUserAttachmentChunk(db, swarm.id, "message", message.id, 0, 3000),
    /attachment before continuing/,
  );
});

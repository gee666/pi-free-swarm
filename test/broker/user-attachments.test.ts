import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { addComment, createPost } from "../../src/broker/wall.js";
import { USER_BODY_PREVIEW_CHARS } from "../../src/limits.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function verify(body: string, raw: string, cwd: string, relative: string) {
  const head = Array.from(raw).slice(0, USER_BODY_PREVIEW_CHARS).join("");
  assert.equal(body, `${head} … [full text: ${relative}]`);
  assert.equal(readFileSync(path.join(cwd, relative), "utf8"), raw);
}

test("User posts and comments preserve large originals with Unicode previews", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  const raw = ` \n${"😀界".repeat(120)}${"large user input\n".repeat(12_000)}  \n`;
  const dir = `.pi/swarm/attachments/${swarm.id}`;
  const post = createPost(db, swarm.id, "User", { title: "User evidence", text: raw }, T0);
  verify(post.text, raw, cwd, `${dir}/post-${post.id}.md`);
  const { comment } = addComment(db, swarm.id, "User", post.id, raw, T0);
  verify(comment.text, raw, cwd, `${dir}/comment-${comment.id}.md`);
});

test("the User preview boundary does not cap worker text", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  const boundary = "😀".repeat(USER_BODY_PREVIEW_CHARS);
  assert.equal(createPost(db, swarm.id, "User", { title: "Boundary", text: boundary }, T0).text, boundary);
  const longer = boundary + "界";
  const user = createPost(db, swarm.id, "User", { title: "Long", text: longer }, T0);
  verify(user.text, longer, cwd, `.pi/swarm/attachments/${swarm.id}/post-${user.id}.md`);
  assert.equal(createPost(db, swarm.id, "John", { title: "Worker policy", text: longer }, T0).text, longer);
});

test("blank User bodies reject without files and short bodies are trimmed", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  assert.throws(() => createPost(db, swarm.id, "User", { title: "Blank", text: " \n ".repeat(1000) }, T0), /empty/);
  assert.equal(existsSync(path.join(cwd, ".pi/swarm/attachments")), false);
  assert.equal(createPost(db, swarm.id, "User", { title: "Short", text: "  short  " }, T0).text, "short");
});

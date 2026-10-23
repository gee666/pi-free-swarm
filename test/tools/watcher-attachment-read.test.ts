import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { createPost, addComment } from "../../src/broker/wall.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { createWatcherToolHandlers } from "../../src/tools/watcher-tools.js";
import { agentToolResult } from "../../src/tools/agent-tool-result.js";
import { initialWallCursor } from "../../src/broker/wall-delta.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 100, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };
function watcher(swarmId: number) {
  return createAgentToolHandlers({ getDb: () => db, swarmId, run: 1, agentName: "Watcher", clock });
}
function next(text: string) {
  return /Next cursor: (\S+)/.exec(text)?.[1];
}
function bodies(text: string) {
  return text
    .split("\n")
    .filter((line) => (line.startsWith("#") || line.startsWith("Post #")) && line.includes(': "'))
    .map((line) => {
      const start = line.indexOf(': "');
      assert.ok(start >= 0, line);
      const value: unknown = JSON.parse(line.slice(start + 2));
      assert.equal(typeof value, "string");
      return value;
    });
}

it("Watcher retrieves full User message attachments through bounded existing thread reads", async () => {
  const swarm = seedSwarm(db);
  const original = " \n" + "🙂漢\n".repeat(4000) + "ATTACHMENT TAIL  ";
  const message = sendMessage(db, swarm.id, "User", ["Watcher"], original, T0);
  assert.match(message.text, /full text:/);
  const tools = createWatcherToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Watcher", clock });
  let after: string | undefined;
  const parts: unknown[] = [];
  let pages = 0;
  do {
    const result = tools.threads({ thread_id: message.threadId, after });
    assert.ok(Buffer.byteLength(result) < 30_000);
    assert.equal((await agentToolResult(result)).details, undefined);
    parts.push(...bodies(result));
    after = next(result);
    assert.ok(++pages < 100);
  } while (after !== undefined);
  assert.equal(parts.join(""), original);
  assert.ok(pages > 1);
});

it("only-new post/comment attachment coverage waits for complete tails and stays isolated", () => {
  const swarm = seedSwarm(db);
  const original = "🙂".repeat(8000) + "POST TAIL";
  const post = createPost(db, swarm.id, "User", { title: "User evidence", text: original }, T0);
  const comment = addComment(db, swarm.id, "User", post.id, "漢".repeat(10000) + "COMMENT TAIL", T0).comment;
  const tools = watcher(swarm.id);
  assert.match(tools.readPosts({}), /full text:/);
  tools.readPosts({ after: initialWallCursor(swarm.id) });
  assert.equal(
    db.sql
      .prepare("SELECT COUNT(*) AS n FROM comment_coverage WHERE name = 'Watcher' AND comment_id = ?")
      .get(comment.id)?.n,
    0,
  );
  let result = tools.readPost({ post_id: post.id, only_new: true });
  assert.match(result, /Complete: false/);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE name = 'Watcher'").get()?.n, 0);
  let after = next(result);
  let pages = 1;
  const parts: unknown[] = [...bodies(result)];
  while (after !== undefined) {
    result = tools.readPost({ post_id: post.id, only_new: true, after });
    parts.push(...bodies(result));
    after = next(result);
    assert.ok(++pages < 100);
  }
  assert.equal(parts.join(""), original + "漢".repeat(10000) + "COMMENT TAIL");
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE name = 'Watcher' AND post_id = ?").get(post.id)?.n,
    1,
  );
  assert.equal(
    db.sql
      .prepare("SELECT COUNT(*) AS n FROM comment_coverage WHERE name = 'Watcher' AND comment_id = ?")
      .get(comment.id)?.n,
    1,
  );
  assert.doesNotMatch(tools.readPost({ post_id: post.id, only_new: true }), /TAIL/);
  const maria = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "Maria", clock });
  assert.match(maria.readPost({ post_id: post.id, only_new: true }), /full text:/);
});

it("Watcher only-new post ranges cover a User attachment only after its final page", () => {
  const swarm = seedSwarm(db);
  const original = "漢🙂".repeat(6000) + "FRESH TAIL";
  const post = createPost(db, swarm.id, "User", { title: "Fresh source", text: original }, T0);
  const tools = watcher(swarm.id);
  let result = tools.readPosts({ only_new: true });
  assert.match(result, /Complete: false/);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE name = 'Watcher' AND post_id = ?").get(post.id)?.n,
    0,
  );
  const parts: unknown[] = [...bodies(result)];
  let after = next(result);
  let pages = 1;
  while (after !== undefined) {
    result = tools.readPosts({ only_new: true, after });
    parts.push(...bodies(result));
    after = next(result);
    assert.ok(++pages < 100);
  }
  assert.equal(parts.join(""), original);
  assert.doesNotMatch(tools.readPosts({ only_new: true }), /FRESH TAIL/);
});

it("missing generated attachments fail without covering their unseen source", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Missing file", text: "x".repeat(1000) }, T0);
  unlinkSync(path.join(db.dataDir, "attachments", String(swarm.id), `post-${post.id}.md`));
  assert.throws(() => watcher(swarm.id).readPost({ post_id: post.id, only_new: true }), /attachment/i);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE name = 'Watcher' AND post_id = ?").get(post.id)?.n,
    0,
  );
});

it("a User-written arbitrary file reference never grants filesystem access", () => {
  const swarm = seedSwarm(db);
  const message = sendMessage(db, swarm.id, "User", ["Watcher"], "[full text: ../../outside.md]", T0);
  const result = watcher(swarm.id).readThread({ thread_id: message.threadId });
  assert.match(result, /outside.md/);
  assert.match(result, /Complete: true/);
});

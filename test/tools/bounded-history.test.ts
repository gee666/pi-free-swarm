import assert from "node:assert/strict";
import { after, it } from "node:test";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { createWatcherToolHandlers } from "../../src/tools/watcher-tools.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const clock = { now: () => T0 + 100, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };
function tools(swarmId: number, agentName = "Maria") {
  return createAgentToolHandlers({ getDb: () => db, swarmId, run: 1, agentName, clock });
}
function next(text: string): string | undefined {
  return /Next cursor: (\S+)/.exec(text)?.[1];
}
function id(text: string): number {
  return Number(/#(\d+)/.exec(text)?.[1]);
}

it("first only-new read catches history oldest-first and isolates agents", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  const john = tools(swarm.id, "John");
  const first = id(maria.post({ title: "First", text: "one" }));
  const second = id(maria.post({ title: "Second", text: "two" }));
  const page = maria.readPosts({ only_new: true, count: 1 });
  assert.match(page, new RegExp(`Post #${first}: First`));
  assert.doesNotMatch(page, /Second/);
  const cursor = next(page);
  assert.ok(cursor);
  assert.match(maria.readPosts({ only_new: true, count: 1, after: cursor }), new RegExp(`Post #${second}: Second`));
  assert.doesNotMatch(maria.readPosts({ only_new: true }), /Post #/);
  assert.match(john.readPosts({ only_new: true }), /First/);
  assert.match(maria.readPosts({}), /First/);
});

it("partial post text never covers unseen tail, and comments remain post-isolated", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  const post = id(maria.post({ title: "Unicode", text: "placeholder" }));
  db.sql.prepare("UPDATE posts SET body = ? WHERE id = ?").run("🙂\n".repeat(3000), post);
  const page = maria.readPost({ post_id: post, only_new: true });
  assert.match(page, /Complete: false/);
  assert.ok(Buffer.byteLength(page) < 30_000);
  assert.match(maria.readPosts({ only_new: true }), /Unicode/);
  let cursor = next(page);
  let chunks = 1;
  while (cursor !== undefined) {
    const result = maria.readPost({ post_id: post, only_new: true, after: cursor });
    assert.ok(Buffer.byteLength(result) < 30_000);
    cursor = next(result);
    chunks++;
    assert.ok(chunks < 10);
  }
  assert.doesNotMatch(maria.readPosts({ only_new: true }), /Unicode/);
  const other = id(maria.post({ title: "Other", text: "other" }));
  maria.comment({ post_id: post, text: "first comment" });
  maria.comment({ post_id: other, text: "other comment" });
  assert.match(maria.readPost({ post_id: post, only_new: true }), /first comment/);
  assert.match(maria.readPost({ post_id: other, only_new: true }), /other comment/);
  assert.doesNotMatch(maria.readPost({ post_id: post, only_new: true }), /first comment/);
  assert.match(maria.readPost({ post_id: post }), /Unicode/);
});

it("post snapshots leave concurrent writes available to later only-new reads", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  const post = id(maria.post({ title: "Snapshot", text: "body" }));
  maria.comment({ post_id: post, text: "existing" });
  const first = maria.readPost({ post_id: post, count: 1, only_new: true });
  const cursor = next(first);
  assert.ok(cursor);
  maria.comment({ post_id: post, text: "arrived later" });
  const second = maria.readPost({ post_id: post, count: 1, only_new: true, after: cursor });
  assert.match(second, /existing/);
  assert.doesNotMatch(second, /arrived later/);
  assert.match(maria.readPost({ post_id: post, only_new: true }), /arrived later/);
});

it("bounded thread pages preserve large multiline messages, snapshot boundaries and membership", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  const sent = maria.message({ to: ["John"], text: "start" });
  const thread = Number(/thread #(\d+)/.exec(sent)?.[1]);
  const message = Number(/message #(\d+)/.exec(sent)?.[1]);
  db.sql.prepare("UPDATE messages SET body = ? WHERE id = ?").run("漢字\n".repeat(3000), message);
  let page = maria.readThread({ thread_id: thread });
  assert.match(page, /Complete: false/);
  maria.replyTo({ thread_id: thread, text: "later" });
  let cursor = next(page);
  let pages = 1;
  while (cursor !== undefined) {
    page = maria.readThread({ thread_id: thread, after: cursor });
    assert.ok(Buffer.byteLength(page) < 30_000);
    assert.doesNotMatch(page, /later/);
    cursor = next(page);
    pages++;
    assert.ok(pages < 10);
  }
  assert.throws(() => tools(swarm.id, "Liam").readThread({ thread_id: thread }), /not a member/);
  assert.throws(() => maria.readThread({ thread_id: thread, after: "bad" }), /after must/);
  assert.throws(() => maria.readPost({ post_id: 99999 }), /not found/);
});

it("fully returned notification threads cover source comments without claiming message acknowledgment", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  const post = id(maria.post({ title: "Notifications", text: "body" }));
  maria.readPost({ post_id: post, only_new: true });
  tools(swarm.id, "John").comment({ post_id: post, text: "delivered through thread history" });
  const row = db.sql
    .prepare(
      "SELECT m.thread_id, m.id FROM messages m JOIN comment_notifications n ON n.message_id = m.id WHERE m.swarm_id = ?",
    )
    .get(swarm.id);
  assert.ok(row);
  const thread = Number(row.thread_id);
  assert.match(maria.readThread({ thread_id: thread }), /delivered through thread history/);
  assert.doesNotMatch(maria.readPost({ post_id: post, only_new: true }), /delivered through thread history/);
  const recipient = db.sql
    .prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'Maria'")
    .get(row.id);
  assert.equal(recipient?.status, "pending");
  const watcher = createWatcherToolHandlers({
    getDb: () => db,
    swarmId: swarm.id,
    run: 1,
    agentName: "Watcher",
    clock,
  });
  assert.match(watcher.threads({ thread_id: thread }), /Complete: true/);
});

it("legacy overview limits output and exposes the next offset without sweeping coverage gaps", () => {
  const swarm = seedSwarm(db);
  const maria = tools(swarm.id);
  for (let i = 0; i < 15; i++) maria.post({ title: `Item ${i}`, text: "body" });
  const page = maria.readPosts({ count: 100 });
  assert.match(page, /Next offset: 12/);
  assert.match(page, /Complete: false/);
  assert.match(maria.readPosts({ only_new: true }), /Item 0/);
  assert.throws(() => maria.readPosts({ count: 101 }), /count/);
});

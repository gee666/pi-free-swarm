import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { markDelivered } from "../../src/broker/delivery-state.js";
import { replyToThread, sendMessage } from "../../src/broker/messages.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { getMailbox, getThread, listInboxAfter } from "../../src/store/message-queries.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getParticipant, listParticipants } from "../../src/store/swarm-queries.js";
import { getPostDetail, listPosts } from "../../src/store/wall-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

describe("participants", () => {
  const swarm = seedSwarm(db);

  it("lists User first, then agents; Main and System never", () => {
    sendMessage(db, swarm.id, "Maria", ["John", "User"], "a", T0);
    const [user, maria, john] = listParticipants(db, swarm.id);
    assert.deepEqual(user, { kind: "user", name: "User", unread: 1, joinedAt: null, lastActivityAt: null });
    assert.equal(maria.kind === "agent" && maria.launchOrder, 0);
    assert.equal(john.unread, 1);
    assert.equal(getParticipant(db, swarm.id, "main"), null);
    assert.equal(getParticipant(db, swarm.id, "JOHN")?.name, "John");
  });
});

describe("mailbox", () => {
  const swarm = seedSwarm(db);
  const t1 = sendMessage(db, swarm.id, "Maria", ["John"], "one", T0 + 1);
  const t2 = sendMessage(db, swarm.id, "Liam", ["John", "Maria"], "two", T0 + 2);
  const reply = replyToThread(db, swarm.id, "John", t1.threadId, "re one", T0 + 3);
  markDelivered(db, swarm.id, "John", [t2.id], T0 + 4);

  it("groups the inbox by thread, newest activity first, with unread counts", () => {
    const inbox = getMailbox(db, swarm.id, "maria", "inbox", { count: 20, offset: 0 });
    assert.equal(inbox.name, "Maria");
    assert.equal(inbox.total, 2);
    assert.equal(inbox.unread, 2);
    assert.deepEqual(
      inbox.threads.map((t) => [t.thread.id, t.messages.map((m) => m.id), t.unread, t.lastMessageAt]),
      [
        [t1.threadId, [reply.id], 1, T0 + 3],
        [t2.threadId, [t2.id], 1, T0 + 2],
      ],
    );
    const paged = getMailbox(db, swarm.id, "Maria", "inbox", { count: 1, offset: 1 });
    assert.deepEqual([paged.total, paged.threads.map((t) => t.thread.id)], [2, [t2.threadId]]);
  });

  it("shows only sent messages in the sent box", () => {
    const sent = getMailbox(db, swarm.id, "John", "sent", { count: 20, offset: 0 });
    assert.deepEqual(
      sent.threads.map((t) => [t.thread.id, t.messages.map((m) => m.id), t.unread]),
      [[t1.threadId, [reply.id], 0]],
    );
    assert.equal(sent.unread, 2, "the badge is always the inbox count");
  });

  it("returns threads and inbox tails", () => {
    assert.deepEqual(
      getThread(db, swarm.id, t1.threadId)?.messages.map((m) => m.text),
      ["one", "re one"],
    );
    assert.deepEqual(getThread(db, swarm.id, t1.threadId)?.thread.members, ["Maria", "John"]);
    assert.equal(getThread(db, swarm.id + 100, t1.threadId), null);
    assert.deepEqual(
      listInboxAfter(db, swarm.id, "John", t1.id).map((m) => m.id),
      [t2.id],
    );
  });
});

describe("wall and stats", () => {
  it("pages the wall and counts activity", () => {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "Maria", { title: "a", text: "x" }, T0);
    createPost(db, swarm.id, "John", { title: "b", text: "y" }, T0);
    addComment(db, swarm.id, "John", post.id, "c", T0);
    sendMessage(db, swarm.id, "John", ["Maria"], "m", T0);
    setAgentStatus(db, swarm.id, "John", "working", T0);

    const page = listPosts(db, swarm.id, { count: 1, offset: 1 });
    assert.deepEqual([page.total, page.posts[0].id, page.posts[0].commentCount], [2, post.id, 1]);
    assert.equal(getPostDetail(db, swarm.id + 100, post.id), null);

    const stats = getStats(db, swarm.id, T0 + 3_000);
    const john = stats?.agents.find((a) => a.name === "John");
    assert.deepEqual(john && [john.posts, john.comments, john.messagesSent, john.activeTimeMs, john.status], [
      1,
      1,
      1,
      3_000,
      "working",
    ]);
    assert.deepEqual(
      stats && [stats.totals.posts, stats.totals.comments, stats.totals.messages, stats.totals.wallTimeMs],
      [2, 1, 1, 3_000],
    );
    assert.deepEqual(
      stats?.agents.map((a) => a.name),
      ["Maria", "John", "Liam"],
    );
    assert.equal(getStats(db, 9999, T0), null);
  });
});

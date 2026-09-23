import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { MessageView } from "../../src/api-types.js";
import { BrokerError } from "../../src/broker/errors.js";
import {
  feedbackPostBody,
  markUserRead,
  readThreadAs,
  replyToThread,
  sendMainFeedback,
  sendMessage,
} from "../../src/broker/messages.js";
import { onLocalMessage } from "../../src/broker/notify.js";
import { endRun } from "../../src/broker/swarms.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { charCount } from "../../src/limits.js";
import { getThread, unreadCounts } from "../../src/store/message-queries.js";
import { getParticipant } from "../../src/store/swarm-queries.js";
import { listPosts } from "../../src/store/wall-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const NOW = T0 + 1_000;

function brokerError(fn: () => unknown, code: string, message: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof BrokerError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

const statuses = (message: MessageView) => message.recipients.map((r) => `${r.name}:${r.status}`);

describe("sendMessage", () => {
  const swarm = seedSwarm(db);

  it("starts a thread with canonical names; agents pending, User delivered", () => {
    const woken: number[] = [];
    const stop = onLocalMessage((id) => woken.push(id));
    const message = sendMessage(db, swarm.id, "maria", ["JOHN", " user ", "John", "Maria"], "hello", NOW);
    stop();
    assert.equal(message.sender, "Maria");
    assert.equal(message.senderKind, "agent");
    assert.deepEqual(statuses(message), ["John:pending", "User:delivered"]);
    assert.equal(message.recipients[1].deliveredAt, NOW);
    assert.deepEqual(getThread(db, swarm.id, message.threadId)?.thread.members, ["Maria", "John", "User"]);
    assert.deepEqual(woken, [swarm.id]);
    assert.equal(getParticipant(db, swarm.id, "Maria")?.joinedAt, NOW);
  });

  it("does not wake the runner for a User-only message", () => {
    const woken: number[] = [];
    const stop = onLocalMessage((id) => woken.push(id));
    sendMessage(db, swarm.id, "Maria", ["User"], "fyi", NOW);
    stop();
    assert.deepEqual(woken, []);
  });

  it("lists the known participants for unknown names; Main and System are not messageable", () => {
    brokerError(
      () => sendMessage(db, swarm.id, "Maria", ["Bob"], "hi", NOW),
      "validation",
      "Unknown participant: Bob. Known participants: Maria, John, Liam, User.",
    );
    brokerError(
      () => sendMessage(db, swarm.id, "Maria", ["Bob", "Main", "system", "John"], "hi", NOW),
      "validation",
      "Unknown participants: Bob, Main, system. Known participants: Maria, John, Liam, User.",
    );
  });

  it("validates sender, recipients and text", () => {
    brokerError(
      () => sendMessage(db, swarm.id, "Maria", ["maria"], "hi", NOW),
      "validation",
      "Add at least one recipient other than yourself.",
    );
    brokerError(
      () => sendMessage(db, swarm.id, "Maria", [], "hi", NOW),
      "validation",
      "Add at least one recipient other than yourself.",
    );
    brokerError(
      () => sendMessage(db, swarm.id, "Maria", ["John"], "x".repeat(243), NOW),
      "validation",
      "Too long: 243/200 characters. Shorten it or point to a file path.",
    );
    brokerError(
      () => sendMessage(db, swarm.id, "Ghost", ["John"], "hi", NOW),
      "validation",
      "Unknown participant: Ghost.",
    );
    brokerError(() => sendMessage(db, 999, "Maria", ["John"], "hi", NOW), "not_found", "Swarm #999 not found.");
  });
});

describe("replyToThread", () => {
  const swarm = seedSwarm(db);
  const first = sendMessage(db, swarm.id, "Maria", ["John", "User"], "plan?", NOW);

  it("goes to every other member", () => {
    const reply = replyToThread(db, swarm.id, "john", first.threadId, "ok", NOW);
    assert.equal(reply.threadId, first.threadId);
    assert.deepEqual(statuses(reply), ["Maria:pending", "User:delivered"]);
  });

  it("rejects non-members, unknown threads and threads of other swarms", () => {
    brokerError(
      () => replyToThread(db, swarm.id, "Liam", first.threadId, "me too", NOW),
      "not_member",
      `You are not a member of thread #${first.threadId}.`,
    );
    brokerError(() => replyToThread(db, swarm.id, "Maria", 9999, "hi", NOW), "not_found", "Thread #9999 not found.");
    const other = seedSwarm(db, { agents: ["Maria", "Zoe"] });
    brokerError(
      () => replyToThread(db, other.id, "Maria", first.threadId, "hi", NOW),
      "not_found",
      `Thread #${first.threadId} not found.`,
    );
  });

  it("reports when nobody else can receive", () => {
    const feedback = sendMainFeedback(db, seedSwarm(db, { agents: ["Solo"] }).id, "redo", NOW);
    const soloSwarm = feedback.swarmId;
    brokerError(
      () => replyToThread(db, soloSwarm, "Solo", feedback.threadId, "ok", NOW),
      "validation",
      `Nobody else is in thread #${feedback.threadId}.`,
    );
  });

  it("lets only members read a thread", () => {
    assert.equal(readThreadAs(db, swarm.id, "maria", first.threadId).messages.length, 2);
    brokerError(
      () => readThreadAs(db, swarm.id, "Liam", first.threadId),
      "not_member",
      `You are not a member of thread #${first.threadId}.`,
    );
  });
});

describe("messages while the swarm is not running", () => {
  it("stores agent recipients undeliverable and adds a System reply to an agent sender", () => {
    const swarm = seedSwarm(db);
    const stale = T0 + 60_000;
    const message = sendMessage(db, swarm.id, "Maria", ["John", "User"], "late", stale);
    assert.deepEqual(statuses(message), ["John:undeliverable", "User:delivered"]);
    const thread = getThread(db, swarm.id, message.threadId);
    const notice = thread?.messages.at(-1);
    assert.equal(notice?.sender, "System");
    assert.equal(notice?.senderKind, "system");
    assert.equal(notice?.text, UNDELIVERABLE_REPLY_TEXT);
    assert.deepEqual(notice && statuses(notice), ["Maria:undeliverable"]);
  });

  it("sends the System reply to the User as delivered after the run ended", () => {
    const swarm = seedSwarm(db);
    assert.equal(endRun(db, swarm.id, process.pid, "finished", NOW), true);
    const message = sendMessage(db, swarm.id, "User", ["Maria"], "still there?", NOW);
    assert.deepEqual(statuses(message), ["Maria:undeliverable"]);
    const notice = getThread(db, swarm.id, message.threadId)?.messages.at(-1);
    assert.deepEqual(notice && statuses(notice), ["User:delivered"]);
    assert.ok(!getThread(db, swarm.id, message.threadId)?.thread.members.includes("System"));
  });

  it("adds no System reply for a User-only message", () => {
    const swarm = seedSwarm(db);
    endRun(db, swarm.id, process.pid, "stopped", NOW);
    const message = sendMessage(db, swarm.id, "Maria", ["User"], "bye", NOW);
    assert.equal(getThread(db, swarm.id, message.threadId)?.messages.length, 1);
  });
});

describe("sendMainFeedback", () => {
  it("messages every agent from Main and posts a short pointer on the wall", () => {
    const swarm = seedSwarm(db);
    const long = "Fix the failing auth tests and the login page layout. ".repeat(10).trim();
    const message = sendMainFeedback(db, swarm.id, long, NOW);
    assert.equal(message.sender, "Main");
    assert.equal(message.text, long);
    assert.deepEqual(statuses(message), ["Maria:pending", "John:pending", "Liam:pending"]);
    const [post] = listPosts(db, swarm.id, { count: 1, offset: 0 }).posts;
    assert.equal(post.author, "Main");
    assert.equal(post.title, "Feedback from Main");
    assert.ok(post.text.endsWith(" …see your messages"));
    assert.ok(charCount(post.text) <= 200);
    // Replies in Main's thread skip Main.
    const reply = replyToThread(db, swarm.id, "John", message.threadId, "on it", NOW);
    assert.deepEqual(statuses(reply), ["Maria:pending", "Liam:pending"]);
  });

  it("keeps short feedback whole and caps at 2000 characters", () => {
    assert.equal(feedbackPostBody("Add tests."), "Add tests. …see your messages");
    assert.equal(charCount(feedbackPostBody("😀".repeat(500))), 200);
    const swarm = seedSwarm(db);
    brokerError(
      () => sendMainFeedback(db, swarm.id, "x".repeat(2001), NOW),
      "validation",
      "Too long: 2001/2000 characters. Shorten it or point to a file path.",
    );
  });
});

describe("markUserRead", () => {
  it("marks only the User's open rows and reports the unread count", () => {
    const swarm = seedSwarm(db);
    const a = sendMessage(db, swarm.id, "Maria", ["User", "John"], "one", NOW);
    const b = sendMessage(db, swarm.id, "John", ["User"], "two", NOW);
    assert.equal(unreadCounts(db, swarm.id, ["User"]).User, 2);
    assert.deepEqual(markUserRead(db, swarm.id, [a.id, a.id, 424242], NOW + 5), { updated: 1, unread: 1 });
    assert.deepEqual(markUserRead(db, swarm.id, [a.id, b.id], NOW + 6), { updated: 1, unread: 0 });
    const [, john] = getThread(db, swarm.id, a.threadId)?.messages[0].recipients ?? [];
    assert.equal(john.status, "pending");
  });
});

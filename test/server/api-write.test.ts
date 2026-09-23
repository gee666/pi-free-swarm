import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type {
  ApiErrorBody,
  CreateCommentResponse,
  CreatePostResponse,
  MarkReadResponse,
  SendMessageResponse,
  ThreadResponse,
} from "../../src/api-types.js";
import { sendMessage } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { NOT_RUNNING_TEXT, UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { DEAD_PID, getJson, postJson, startTestBoard, type TestBoard } from "./helpers.js";

let board: TestBoard;
let swarmId: number;
let url: (suffix: string) => string;

before(async () => {
  board = await startTestBoard();
  swarmId = seedSwarm(board.temp.db, { now: Date.now() }).id;
  url = (suffix) => `${board.base}/api/swarms/${swarmId}${suffix}`;
});
after(() => board.close());

async function expectError(
  response: Promise<{ status: number; body: unknown }>,
  status: number,
  error: ApiErrorBody,
): Promise<void> {
  const { status: actual, body } = await response;
  assert.equal(actual, status);
  assert.deepEqual(body, error);
}

function messageCount(): number {
  return Number(board.temp.db.sql.prepare("SELECT COUNT(*) AS n FROM messages").get()?.n);
}

describe("request bodies", () => {
  it("rejects bad JSON, non-objects, wrong content types, oversized bodies and wrong field types", async () => {
    const posts = url("/posts");
    await expectError(postJson(posts, "{nope"), 400, {
      error: "bad_request",
      message: "Request body is not valid JSON.",
    });
    await expectError(postJson(posts, "[1]"), 400, {
      error: "bad_request",
      message: "Request body must be a JSON object.",
    });
    await expectError(postJson(posts, { title: "a", text: "b" }, "text/plain"), 400, {
      error: "bad_request",
      message: "Content-Type must be application/json.",
    });
    await expectError(postJson(posts, { title: "a", text: "x".repeat(70_000) }), 400, {
      error: "bad_request",
      message: "Request body is larger than 64 KB.",
    });
    await expectError(postJson(posts, { text: "b" }), 400, {
      error: "bad_request",
      message: '"title" must be a string.',
      field: "title",
    });
    await expectError(postJson(url("/messages"), { to: "Maria", text: "hi" }), 400, {
      error: "bad_request",
      message: '"to" must be an array of strings.',
      field: "to",
    });
  });

  it("answers unknown API paths and wrong methods with a JSON 404", async () => {
    const unknown = await getJson<ApiErrorBody>(`${board.base}/api/nothing`);
    assert.deepEqual([unknown.status, unknown.body.error], [404, "not_found"]);
    const wrongMethod = await getJson<ApiErrorBody>(url("/messages"));
    assert.deepEqual([wrongMethod.status, wrongMethod.body.error], [404, "not_found"]);
  });
});

describe("wall writes", () => {
  it("creates posts and comments as User", async () => {
    const created = await postJson<CreatePostResponse>(url("/posts"), { title: " Idea ", text: "Try caching." });
    assert.equal(created.status, 201);
    assert.deepEqual(
      [created.body.post.author, created.body.post.title, created.body.post.commentCount],
      ["User", "Idea", 0],
    );
    const comment = await postJson<CreateCommentResponse>(url(`/posts/${created.body.post.id}/comments`), {
      text: "Agreed",
    });
    assert.equal(comment.status, 201);
    assert.deepEqual([comment.body.comment.author, comment.body.commentCount], ["User", 1]);
  });

  it("returns the limit errors, 404s and keeps the wall writable after the run ended", async () => {
    await expectError(postJson(url("/posts"), { title: "t".repeat(72), text: "x" }), 400, {
      error: "validation",
      message: "Title too long: 72/60 characters. Shorten it.",
      field: "title",
    });
    await expectError(postJson(url("/posts"), { title: "t", text: "x".repeat(243) }), 400, {
      error: "validation",
      message: "Too long: 243/200 characters. Shorten it or point to a file path.",
      field: "text",
    });
    await expectError(postJson(url("/posts/999/comments"), { text: "hi" }), 404, {
      error: "not_found",
      message: "Post #999 not found.",
    });
    const postId = createPost(board.temp.db, swarmId, "Maria", { title: "t", text: "x" }, Date.now()).id;
    await expectError(postJson(url(`/posts/${postId}/comments`), { text: "  " }), 400, {
      error: "validation",
      message: "Text is empty.",
      field: "text",
    });
    await expectError(postJson(`${board.base}/api/swarms/999/posts`, { title: "t", text: "x" }), 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
    const ended = seedSwarm(board.temp.db, { now: Date.now(), name: "ended" }).id;
    endRun(board.temp.db, ended, process.pid, "finished", Date.now());
    const post = await postJson(`${board.base}/api/swarms/${ended}/posts`, { title: "t", text: "x" });
    assert.equal(post.status, 201);
  });
});

describe("messages", () => {
  it("sends a new thread from User with pending agent recipients", async () => {
    const { status, body } = await postJson<SendMessageResponse>(url("/messages"), {
      to: ["maria", "John"],
      text: "Go",
    });
    assert.equal(status, 201);
    assert.equal(body.message.sender, "User");
    assert.deepEqual(
      body.message.recipients.map((r) => [r.name, r.status]),
      [
        ["Maria", "pending"],
        ["John", "pending"],
      ],
    );
  });

  it("validates recipients and text", async () => {
    await expectError(postJson(url("/messages"), { to: ["Bob"], text: "hi" }), 400, {
      error: "validation",
      message: "Unknown participant: Bob. Known participants: Maria, John, Liam, User.",
      field: "to",
    });
    await expectError(postJson(url("/messages"), { to: ["User"], text: "hi" }), 400, {
      error: "validation",
      message: "Add at least one recipient other than yourself.",
      field: "to",
    });
    await expectError(postJson(url("/messages"), { to: ["Maria"], text: "" }), 400, {
      error: "validation",
      message: "Text is empty.",
      field: "text",
    });
  });

  it("replies in a thread and refuses non-members and missing threads", async () => {
    const { db } = board.temp;
    const thread = sendMessage(db, swarmId, "Maria", ["User"], "Question?", Date.now()).threadId;
    const replied = await postJson<SendMessageResponse>(url(`/threads/${thread}/reply`), { text: "Answer." });
    assert.equal(replied.status, 201);
    assert.deepEqual(
      replied.body.message.recipients.map((r) => [r.name, r.status]),
      [["Maria", "pending"]],
    );
    const private_ = sendMessage(db, swarmId, "Maria", ["John"], "Between us", Date.now()).threadId;
    await expectError(postJson(url(`/threads/${private_}/reply`), { text: "Hi" }), 403, {
      error: "not_member",
      message: `You are not a member of thread #${private_}.`,
    });
    await expectError(postJson(url("/threads/999/reply"), { text: "Hi" }), 404, {
      error: "not_found",
      message: "Thread #999 not found.",
    });
  });

  it("answers 409 swarm_not_running for ended and interrupted swarms and stores nothing", async () => {
    const { db } = board.temp;
    const ended = seedSwarm(db, { now: Date.now(), name: "done" });
    const thread = sendMessage(db, ended.id, "Maria", ["User"], "Bye", Date.now()).threadId;
    endRun(db, ended.id, process.pid, "finished", Date.now());
    const orphaned = seedSwarm(db, { now: Date.now(), name: "orphan", runnerPid: DEAD_PID });
    const notRunning: ApiErrorBody = { error: "swarm_not_running", message: NOT_RUNNING_TEXT };
    const before = messageCount();
    for (const id of [ended.id, orphaned.id]) {
      await expectError(
        postJson(`${board.base}/api/swarms/${id}/messages`, { to: ["Maria"], text: "hi" }),
        409,
        notRunning,
      );
    }
    await expectError(
      postJson(`${board.base}/api/swarms/${ended.id}/threads/${thread}/reply`, { text: "hi" }),
      409,
      notRunning,
    );
    assert.equal(messageCount(), before);
    await expectError(postJson(`${board.base}/api/swarms/999/messages`, { to: ["Maria"], text: "hi" }), 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
  });
});

describe("the liveness race", () => {
  let raceBoard: TestBoard;
  before(async () => {
    // The pre-check believes the runner is alive; the broker's own check inside the insert finds it gone.
    raceBoard = await startTestBoard({ alive: () => true });
  });
  after(() => raceBoard.close());

  it("stores the message as undeliverable with a System reply", async () => {
    const { db } = raceBoard.temp;
    const id = seedSwarm(db, { now: Date.now(), runnerPid: DEAD_PID }).id;
    const sent = await postJson<SendMessageResponse>(`${raceBoard.base}/api/swarms/${id}/messages`, {
      to: ["Maria"],
      text: "Still there?",
    });
    assert.equal(sent.status, 201);
    assert.deepEqual(
      sent.body.message.recipients.map((r) => [r.name, r.status]),
      [["Maria", "undeliverable"]],
    );
    const thread = await getJson<ThreadResponse>(
      `${raceBoard.base}/api/swarms/${id}/threads/${sent.body.message.threadId}`,
    );
    assert.deepEqual(
      thread.body.messages.map((m) => [m.sender, m.text, m.recipients.map((r) => `${r.name}:${r.status}`)]),
      [
        ["User", "Still there?", ["Maria:undeliverable"]],
        ["System", UNDELIVERABLE_REPLY_TEXT, ["User:delivered"]],
      ],
    );
  });
});

describe("User read marks", () => {
  it("marks the User's messages read and reports the unread count", async () => {
    const { db } = board.temp;
    const reads = url("/participants/User/read");
    const unreadBefore = Number(
      db.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = 'User' AND status IN ('pending', 'delivered')",
        )
        .get(swarmId)?.n,
    );
    const first = sendMessage(db, swarmId, "Maria", ["User", "John"], "One", Date.now());
    const second = sendMessage(db, swarmId, "Liam", ["User"], "Two", Date.now());
    const marked = await postJson<MarkReadResponse>(reads, { messageIds: [first.id, second.id, first.id] });
    assert.equal(marked.status, 200);
    assert.deepEqual(marked.body, { updated: 2, unread: unreadBefore });
    const again = await postJson<MarkReadResponse>(url("/participants/user/read"), { messageIds: [first.id] });
    assert.deepEqual(again.body, { updated: 0, unread: unreadBefore });
    const johnStatus = db.sql
      .prepare("SELECT status FROM message_recipients WHERE message_id = ? AND name = 'John'")
      .get(first.id)?.status;
    assert.equal(johnStatus, "pending", "other recipients are untouched");
  });

  it("answers 404 for other participants and 400 for bad ids", async () => {
    await expectError(postJson(url("/participants/Maria/read"), { messageIds: [1] }), 404, {
      error: "not_found",
      message: "Only User's messages can be marked read here, not Maria's.",
    });
    await expectError(postJson(url("/participants/User/read"), { messageIds: [1, "2"] }), 400, {
      error: "bad_request",
      message: '"messageIds" must be an array of positive integers.',
      field: "messageIds",
    });
    await expectError(postJson(`${board.base}/api/swarms/999/participants/User/read`, { messageIds: [1] }), 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
  });
});

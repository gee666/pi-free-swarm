import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  ApiErrorBody,
  MailboxResponse,
  PostDetailResponse,
  PostListResponse,
  SessionPage,
  StatsResponse,
  SwarmDetailResponse,
  SwarmListResponse,
  ThreadResponse,
} from "../../src/api-types.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { replyToThread, sendMessage } from "../../src/broker/messages.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { agentSessionFile } from "../../src/store/db.js";
import { assistantLine, headerLine, userLine } from "../fixtures/sessions/helpers.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard, type TestBoard } from "./helpers.js";

let board: TestBoard;
let swarmId: number;
let otherSwarmId: number;
let url: (suffix: string) => string;

before(async () => {
  board = await startTestBoard();
  const { db } = board.temp;
  swarmId = seedSwarm(db, { now: Date.now() }).id;
  otherSwarmId = seedSwarm(db, { now: Date.now(), name: "other", agents: ["Ada", "Bo"] }).id;
  url = (suffix) => `${board.base}/api/swarms/${swarmId}${suffix}`;
});
after(() => board.close());

async function expectError(target: string, status: number, error: ApiErrorBody): Promise<void> {
  const response = await getJson<ApiErrorBody>(target);
  assert.equal(response.status, status, target);
  assert.deepEqual(response.body, error);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
}

describe("swarms", () => {
  it("lists swarms newest first", async () => {
    const { status, body } = await getJson<SwarmListResponse>(`${board.base}/api/swarms`);
    assert.equal(status, 200);
    assert.deepEqual(
      body.swarms.map((s) => [s.id, s.status, s.acceptsMessages]),
      [
        [otherSwarmId, "starting", true],
        [swarmId, "starting", true],
      ],
    );
  });

  it("returns the detail with User first, then agents by launch order", async () => {
    const { status, body } = await getJson<SwarmDetailResponse>(url(""));
    assert.equal(status, 200);
    assert.equal(body.swarm.id, swarmId);
    assert.deepEqual(
      body.participants.map((p) => p.name),
      ["User", "Maria", "John", "Liam"],
    );
  });

  it("answers 404 for a missing swarm and for non-numeric ids", async () => {
    await expectError(`${board.base}/api/swarms/999`, 404, { error: "not_found", message: "Swarm #999 not found." });
    const response = await getJson<ApiErrorBody>(`${board.base}/api/swarms/abc`);
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "not_found");
  });
});

describe("wall", () => {
  let postIds: number[];
  before(() => {
    const { db } = board.temp;
    postIds = ["one", "two", "three"].map(
      (title) => createPost(db, swarmId, "Maria", { title, text: `${title} text` }, Date.now()).id,
    );
    addComment(db, swarmId, "John", postIds[0], "first!", Date.now());
    addComment(db, swarmId, "Liam", postIds[0], "second", Date.now());
  });

  it("pages posts newest first with comment counts", async () => {
    const first = await getJson<PostListResponse>(url("/posts?count=2"));
    assert.equal(first.status, 200);
    assert.deepEqual(
      first.body.posts.map((p) => p.title),
      ["three", "two"],
    );
    assert.equal(first.body.total, 3);
    const rest = await getJson<PostListResponse>(url("/posts?count=2&offset=2"));
    assert.deepEqual(
      rest.body.posts.map((p) => [p.title, p.commentCount]),
      [["one", 2]],
    );
    const defaults = await getJson<PostListResponse>(url("/posts"));
    assert.equal(defaults.body.posts.length, 3);
  });

  it("validates paging", async () => {
    const count = { error: "validation", message: "count must be an integer 1–100.", field: "count" } as const;
    await expectError(url("/posts?count=0"), 400, count);
    await expectError(url("/posts?count=101"), 400, count);
    await expectError(url("/posts?count=abc"), 400, count);
    await expectError(url("/posts?count=1.5"), 400, count);
    await expectError(url("/posts?offset=-1"), 400, {
      error: "validation",
      message: "offset must be an integer >= 0.",
      field: "offset",
    });
    await expectError(`${board.base}/api/swarms/999/posts`, 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
  });

  it("returns a post with its comments oldest first", async () => {
    const { status, body } = await getJson<PostDetailResponse>(url(`/posts/${postIds[0]}`));
    assert.equal(status, 200);
    assert.equal(body.post.title, "one");
    assert.deepEqual(
      body.comments.map((c) => [c.author, c.text]),
      [
        ["John", "first!"],
        ["Liam", "second"],
      ],
    );
  });

  it("answers 404 for missing posts and posts of another swarm", async () => {
    await expectError(url("/posts/999"), 404, { error: "not_found", message: "Post #999 not found." });
    await expectError(`${board.base}/api/swarms/${otherSwarmId}/posts/${postIds[0]}`, 404, {
      error: "not_found",
      message: `Post #${postIds[0]} not found.`,
    });
  });
});

describe("messages", () => {
  let threadId: number;
  let userThreadId: number;
  before(() => {
    const { db } = board.temp;
    const opening = sendMessage(db, swarmId, "Maria", ["User", "John"], "Plan is on the wall.", Date.now());
    threadId = opening.threadId;
    replyToThread(db, swarmId, "John", threadId, "Agreed.", Date.now());
    sendMessage(db, swarmId, "Maria", ["John"], "Just us.", Date.now());
    userThreadId = sendMessage(db, swarmId, "User", ["Liam"], "Status?", Date.now()).threadId;
  });

  it("groups the inbox by thread with only the box's messages and unread counts", async () => {
    const { status, body } = await getJson<MailboxResponse>(url("/participants/User/messages"));
    assert.equal(status, 200);
    assert.equal(body.box, "inbox");
    assert.equal(body.total, 1);
    assert.equal(body.unread, 2);
    assert.equal(body.threads[0].thread.id, threadId);
    assert.deepEqual(body.threads[0].thread.members, ["Maria", "User", "John"]);
    assert.deepEqual(
      body.threads[0].messages.map((m) => [m.sender, m.text]),
      [
        ["Maria", "Plan is on the wall."],
        ["John", "Agreed."],
      ],
    );
    assert.equal(body.threads[0].unread, 2);
  });

  it("returns the sent box and resolves names case-insensitively", async () => {
    const sent = await getJson<MailboxResponse>(url("/participants/user/messages?box=sent"));
    assert.equal(sent.body.name, "User");
    assert.deepEqual(
      sent.body.threads.map((t) => t.thread.id),
      [userThreadId],
    );
    assert.equal(sent.body.threads[0].unread, 0);
    const maria = await getJson<MailboxResponse>(url("/participants/maria/messages?box=sent&count=1"));
    assert.equal(maria.body.total, 2);
    assert.equal(maria.body.threads.length, 1);
    assert.equal(maria.body.threads[0].messages[0].text, "Just us.");
  });

  it("validates the box and paging and answers 404 for unknown participants", async () => {
    await expectError(url("/participants/User/messages?box=trash"), 400, {
      error: "validation",
      message: 'box must be "inbox" or "sent".',
      field: "box",
    });
    await expectError(url("/participants/User/messages?count=500"), 400, {
      error: "validation",
      message: "count must be an integer 1–100.",
      field: "count",
    });
    await expectError(url("/participants/Bob/messages"), 404, {
      error: "not_found",
      message: "Participant Bob not found.",
    });
    await expectError(url("/participants/Main/messages"), 404, {
      error: "not_found",
      message: "Participant Main not found.",
    });
  });

  it("returns a whole thread and 404 for a missing one", async () => {
    const { status, body } = await getJson<ThreadResponse>(url(`/threads/${threadId}`));
    assert.equal(status, 200);
    assert.equal(body.messages.length, 2);
    assert.deepEqual(
      body.messages[1].recipients.map((r) => [r.name, r.status]),
      [
        ["Maria", "pending"],
        ["User", "delivered"],
      ],
    );
    await expectError(url("/threads/999"), 404, { error: "not_found", message: "Thread #999 not found." });
    await expectError(`${board.base}/api/swarms/${otherSwarmId}/threads/${threadId}`, 404, {
      error: "not_found",
      message: `Thread #${threadId} not found.`,
    });
  });
});

describe("session", () => {
  let file: string;
  before(() => {
    file = agentSessionFile(board.temp.db.dataDir, swarmId, "Maria");
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, headerLine());
    for (let i = 0; i < 5; i++) appendFileSync(file, userLine(`u${i}`, `prompt ${i}`));
  });

  it("pages newest first through before cursors and picks up appends with after", async () => {
    const newest = await getJson<SessionPage>(url("/agents/maria/session?limit=2"));
    assert.equal(newest.status, 200);
    assert.equal(newest.body.agent, "Maria");
    assert.deepEqual(
      newest.body.items.map((item) => item.id),
      ["u4:0", "u3:0"],
    );
    assert.ok(newest.body.olderCursor !== null && newest.body.newestCursor !== null);
    const older = await getJson<SessionPage>(
      url(`/agents/Maria/session?limit=2&before=${encodeURIComponent(newest.body.olderCursor)}`),
    );
    assert.deepEqual(
      older.body.items.map((item) => item.id),
      ["u2:0", "u1:0"],
    );

    const after = url(`/agents/Maria/session?after=${encodeURIComponent(newest.body.newestCursor)}`);
    assert.deepEqual((await getJson<SessionPage>(after)).body.items, []);
    appendFileSync(file, assistantLine("a5", [{ type: "text", text: "done" }]));
    assert.deepEqual(
      (await getJson<SessionPage>(after)).body.items.map((item) => item.id),
      ["a5:0"],
    );
  });

  it("returns an empty page while the session file does not exist", async () => {
    const { status, body } = await getJson<SessionPage>(url("/agents/John/session"));
    assert.equal(status, 200);
    assert.deepEqual(body, { agent: "John", items: [], olderCursor: null, newestCursor: null });
  });

  it("rejects bad cursors and limits and answers 404 for non-agents", async () => {
    await expectError(url("/agents/Maria/session?before=abc"), 400, {
      error: "validation",
      message: "Invalid before cursor.",
      field: "before",
    });
    await expectError(url("/agents/Maria/session?after=3"), 400, {
      error: "validation",
      message: "The cursor does not match this session.",
      field: "after",
    });
    await expectError(url("/agents/Maria/session?limit=0"), 400, {
      error: "validation",
      message: "limit must be an integer 1–200.",
      field: "limit",
    });
    await expectError(url("/agents/Maria/session?limit=201"), 400, {
      error: "validation",
      message: "limit must be an integer 1–200.",
      field: "limit",
    });
    await expectError(url("/agents/User/session"), 404, { error: "not_found", message: "Agent User not found." });
    await expectError(url("/agents/Bob/session"), 404, { error: "not_found", message: "Agent Bob not found." });
    await expectError(`${board.base}/api/swarms/999/agents/Maria/session`, 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
  });
});

describe("stats", () => {
  it("totals match the usage rows", async () => {
    const { db } = board.temp;
    const sample = (kind: "message" | "compaction", input: number, cost: number) => ({
      kind,
      input,
      output: input * 2,
      cacheRead: 5,
      cacheWrite: 1,
      cost,
      model: "m",
    });
    recordUsage(db, swarmId, "Maria", sample("message", 100, 0.25), Date.now());
    recordUsage(db, swarmId, "Maria", sample("compaction", 40, 0.05), Date.now());
    recordUsage(db, swarmId, "John", sample("message", 10, 0.5), Date.now());

    const { status, body } = await getJson<StatsResponse>(url("/stats"));
    assert.equal(status, 200);
    assert.deepEqual(
      body.agents.map((a) => a.name),
      ["Maria", "John", "Liam"],
    );
    const usage = db.sql
      .prepare(
        `SELECT SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cacheRead,
           SUM(cache_write) AS cacheWrite, SUM(cost) AS cost, SUM(kind = 'message') AS turns
         FROM usage WHERE swarm_id = ?`,
      )
      .get(swarmId);
    const { input, output, cacheRead, cacheWrite, cost, turns } = body.totals;
    assert.deepEqual({ input, output, cacheRead, cacheWrite, cost, turns }, { ...usage });
    assert.deepEqual([input, turns], [150, 2]);
    assert.equal(body.agents[0].turns, 1);
    assert.ok(Math.abs(body.agents[0].cost - 0.3) < 1e-9);
    const sum = body.agents.reduce((total, agent) => total + agent.input, 0);
    assert.equal(sum, input);
    await expectError(`${board.base}/api/swarms/999/stats`, 404, {
      error: "not_found",
      message: "Swarm #999 not found.",
    });
  });
});

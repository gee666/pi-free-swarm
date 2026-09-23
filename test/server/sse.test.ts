import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ApiErrorBody } from "../../src/api-types.js";
import { markSwarmRunning } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { EVENTS_TAIL_MS, SSE_KEEPALIVE_MS } from "../../src/constants.js";
import { startBoardServer } from "../../src/server/http.js";
import { SessionReader, SessionWatcher } from "../../src/server/sessions.js";
import { SseHub } from "../../src/server/sse.js";
import { agentSessionFile, openSwarmDb } from "../../src/store/db.js";
import { FakeClock } from "../agents/fake-clock.js";
import { headerLine, userLine } from "../fixtures/sessions/helpers.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";
import {
  getJson,
  isType,
  openSse,
  startTestBoard,
  waitFor,
  type SseClient,
  type SseFrame,
  type TestBoard,
} from "./helpers.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const writer = fileURLToPath(new URL("./fixtures/post-writer.ts", import.meta.url));

let board: TestBoard;
let swarmId: number;
let otherId: number;
const clients: SseClient[] = [];

async function connect(query: string, headers: Record<string, string> = {}): Promise<SseClient> {
  const client = await openSse(`${board.base}/events${query}`, headers);
  clients.push(client);
  return client;
}

function post(id: number, title: string): number {
  return createPost(board.temp.db, id, "Maria", { title, text: "x" }, Date.now()).id;
}

const postTitled = (title: string) => (frame: SseFrame) =>
  frame.event?.type === "post.created" && frame.event.payload.post.title === title;

before(async () => {
  board = await startTestBoard();
  swarmId = seedSwarm(board.temp.db, { now: Date.now() }).id;
  otherId = seedSwarm(board.temp.db, { now: Date.now(), name: "other", agents: ["Maria", "Ada"] }).id;
});
after(async () => {
  for (const client of clients) client.close();
  await board.close();
});

describe("SSE from the outbox", () => {
  it("pushes events written through another DB handle, with the outbox id", async () => {
    const client = await connect(`?swarm=${swarmId}`);
    const second = openSwarmDb(board.temp.db.path, { create: false });
    const postId = createPost(second, swarmId, "John", { title: "other handle", text: "x" }, Date.now()).id;
    second.close();
    const frame = await client.next(postTitled("other handle"));
    assert.equal(frame.event?.swarmId, swarmId);
    assert.equal(frame.id, String(frame.event?.id));
    assert.ok(frame.event?.type === "post.created" && frame.event.payload.post.id === postId);
  });

  it("pushes events written by a child process", async () => {
    const client = await connect(`?swarm=${swarmId}`);
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx/esm", writer, board.temp.db.path, String(swarmId), "Liam", "child post"],
      { cwd: repoRoot },
    );
    const frame = await client.next(postTitled("child post"));
    assert.ok(frame.event?.type === "post.created" && frame.event.payload.post.author === "Liam");
  });

  it("filters per swarm; the picker stream carries only swarm.updated of every swarm", async () => {
    const mine = await connect(`?swarm=${swarmId}`);
    const theirs = await connect(`?swarm=${otherId}`);
    const picker = await connect("");
    post(otherId, "for other");
    post(swarmId, "for mine");
    markSwarmRunning(board.temp.db, otherId, process.pid, Date.now());
    await theirs.next(postTitled("for other"));
    await mine.next(postTitled("for mine"));
    const updated = await picker.next(isType("swarm.updated"));
    assert.equal(updated.event?.swarmId, otherId);
    await theirs.next(isType("swarm.updated"));
    assert.ok(mine.frames.every((frame) => frame.event === null || frame.event.swarmId === swarmId));
    assert.ok(theirs.frames.every((frame) => frame.event === null || frame.event.swarmId === otherId));
    assert.ok(picker.frames.every((frame) => frame.event === null || frame.event.type === "swarm.updated"));
  });

  it("replays missed events after Last-Event-ID, then continues live without duplicates", async () => {
    const first = await connect(`?swarm=${swarmId}`);
    post(swarmId, "seen");
    const seen = await first.next(postTitled("seen"));
    first.close();
    post(otherId, "not mine");
    post(swarmId, "missed 1");
    post(swarmId, "missed 2");
    // Let the tail pass the missed rows so the replay (not the live tail) has to deliver them.
    await new Promise((resolve) => setTimeout(resolve, EVENTS_TAIL_MS * 3));
    const again = await connect(`?swarm=${swarmId}`, { "Last-Event-ID": seen.id ?? "" });
    post(swarmId, "live");
    await again.next(postTitled("live"));
    const titles = again.frames.flatMap((frame) =>
      frame.event?.type === "post.created" ? [frame.event.payload.post.title] : [],
    );
    assert.deepEqual(titles, ["missed 1", "missed 2", "live"]);
    const ids = again.frames.flatMap((frame) => (frame.id === null ? [] : [Number(frame.id)]));
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a - b),
    );
    assert.equal(new Set(ids).size, ids.length);
  });

  it("rejects bad swarm ids and missing swarms", async () => {
    const bad = await getJson<ApiErrorBody>(`${board.base}/events?swarm=abc`);
    assert.deepEqual([bad.status, bad.body.error], [400, "bad_request"]);
    const missing = await getJson<ApiErrorBody>(`${board.base}/events?swarm=999`);
    assert.deepEqual([missing.status, missing.body.message], [404, "Swarm #999 not found."]);
  });
});

describe("session.appended", () => {
  it("is pushed without an id when an agent's session file grows", async () => {
    const file = agentSessionFile(board.temp.db.dataDir, swarmId, "Maria");
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, headerLine());
    const client = await connect(`?swarm=${swarmId}`);
    // The watcher's first check records the starting point; only growth after it is reported.
    await new Promise((resolve) => setTimeout(resolve, 200));
    appendFileSync(file, userLine("u1", "hello"));
    const frame = await client.next(isType("session.appended"));
    assert.equal(frame.id, null);
    assert.ok(frame.event?.type === "session.appended");
    assert.equal(frame.event.id, null);
    assert.equal(frame.event.payload.agent, "Maria");
    assert.match(frame.event.payload.newestCursor, /^\d+$/);
  });
});

class CountingWatcher extends SessionWatcher {
  active = 0;
  override watch(agent: string, sessionFile: string, onAppended: (cursor: string) => void): () => void {
    this.active++;
    const stop = super.watch(agent, sessionFile, onAppended);
    return () => {
      this.active--;
      stop();
    };
  }
}

describe("SseHub with a fake clock", () => {
  it("tails every EVENTS_TAIL_MS, sends keep-alives, and watches sessions only while a swarm has clients", async (t) => {
    const temp = createTempDb();
    const clock = new FakeClock(Date.now());
    const watcher = new CountingWatcher({ reader: new SessionReader(), clock });
    const hub = new SseHub({ db: temp.db, clock, watcher });
    const id = seedSwarm(temp.db, { now: Date.now(), agents: ["Maria", "John"] }).id;
    hub.start();
    const server = await startBoardServer({ candidates: [0], uiDir: temp.cwd, routes: [hub.route] });
    t.after(async () => {
      hub.stop();
      await server.close();
      temp.cleanup();
    });
    const url = `http://127.0.0.1:${server.port}/events?swarm=${id}`;
    const one = await openSse(url);
    const two = await openSse(url);
    assert.equal(watcher.active, 2, "one watch per agent, shared by both clients");

    createPost(temp.db, id, "Maria", { title: "tick", text: "x" }, Date.now());
    clock.advance(EVENTS_TAIL_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(one.frames.filter((frame) => frame.event !== null).length, 0);
    clock.advance(1);
    await one.next(isType("post.created"));

    clock.advance(SSE_KEEPALIVE_MS);
    await one.next((frame) => frame.comment === "keep-alive");

    one.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(watcher.active, 2, "still watched for the remaining client");
    two.close();
    await waitFor(() => (watcher.active === 0 ? true : null), 2_000, "watchers released");
  });
});

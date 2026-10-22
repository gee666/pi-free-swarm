import assert from "node:assert/strict";
import { it } from "node:test";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { startBoardServer } from "../../src/server/http.js";
import { SessionReader, SessionWatcher } from "../../src/server/sessions.js";
import { SseHub } from "../../src/server/sse.js";
import { insertEvent, latestEventId, pruneEvents } from "../../src/store/events.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";
import { isType, openSse } from "./helpers.js";

it("SSE tails and replays known events beyond unknown-only raw pages without cross-client leaks", async (t) => {
  const temp = createTempDb();
  const a = seedSwarm(temp.db);
  const b = seedSwarm(temp.db, { name: "other" });
  const clock = new FakeClock(T0);
  const watcher = new SessionWatcher({ reader: new SessionReader(), clock });
  const hub = new SseHub({ db: temp.db, clock, watcher });
  hub.start();
  const server = await startBoardServer({ candidates: [0], uiDir: temp.cwd, routes: [hub.route] });
  t.after(async () => {
    hub.stop();
    await server.close();
    temp.cleanup();
  });
  const url = `http://127.0.0.1:${server.port}/events?swarm=${a.id}`;
  const live = await openSse(url);
  t.after(() => live.close());
  const before = latestEventId(temp.db);
  temp.db.write((tx) => {
    const insert = tx.sql.prepare(
      "INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, 'future', '{}', ?)",
    );
    for (let i = 0; i < 1_000; i++) insert.run(a.id, T0);
    insertEvent(tx, b.id, "session.appended", { agent: "other", newestCursor: "1" }, T0);
    insertEvent(tx, a.id, "session.appended", { agent: "Maria", newestCursor: "2" }, T0);
  });
  clock.advance(EVENTS_TAIL_MS);
  const frame = await live.next(isType("session.appended"));
  assert.equal(frame.event?.swarmId, a.id);
  const replay = await openSse(url, { "Last-Event-ID": String(before) });
  t.after(() => replay.close());
  const recovered = await replay.next(isType("session.appended"));
  assert.equal(recovered.id, frame.id);
  assert.ok(replay.frames.every((item) => item.event === null || item.event.swarmId === a.id));
});

it(
  "SSE closes only live streams overtaken by pruning so their existing reconnect refresh can recover",
  { timeout: 5_000 },
  async (t) => {
    const temp = createTempDb();
    const a = seedSwarm(temp.db);
    const b = seedSwarm(temp.db, { name: "other" });
    const clock = new FakeClock(T0);
    const hub = new SseHub({ db: temp.db, clock, watcher: new SessionWatcher({ reader: new SessionReader(), clock }) });
    hub.start();
    const server = await startBoardServer({ candidates: [0], uiDir: temp.cwd, routes: [hub.route] });
    t.after(async () => {
      hub.stop();
      await server.close();
      temp.cleanup();
    });
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`http://127.0.0.1:${server.port}/events?swarm=${a.id}`, { signal: controller.signal });
    assert.ok(response.body);
    const reader = response.body.getReader();
    await reader.read();
    const other = await openSse(`http://127.0.0.1:${server.port}/events?swarm=${b.id}`);
    t.after(() => other.close());
    insertEvent(temp.db, a.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0);
    insertEvent(temp.db, b.id, "session.appended", { agent: "John", newestCursor: "2" }, T0 + 2);
    const prepare = temp.db.sql.prepare.bind(temp.db.sql);
    let pruned = false;
    temp.db.sql.prepare = (sql) => {
      if (!pruned && sql.startsWith("SELECT * FROM events WHERE id >")) {
        pruned = true;
        pruneEvents(temp.db, T0 + 1);
      }
      return prepare(sql);
    };
    clock.advance(EVENTS_TAIL_MS);
    assert.equal((await reader.read()).done, true);
    const live = await other.next(isType("session.appended"));
    assert.equal(live.event?.swarmId, b.id);
  },
);

it("SSE sends explicit retention-gap metadata only to affected reconnecting streams", async (t) => {
  const temp = createTempDb();
  const a = seedSwarm(temp.db);
  const b = seedSwarm(temp.db, { name: "other" });
  const before = latestEventId(temp.db);
  insertEvent(temp.db, a.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0);
  pruneEvents(temp.db, T0 + 1);
  const clock = new FakeClock(T0 + 2);
  const hub = new SseHub({ db: temp.db, clock, watcher: new SessionWatcher({ reader: new SessionReader(), clock }) });
  hub.start();
  const server = await startBoardServer({ candidates: [0], uiDir: temp.cwd, routes: [hub.route] });
  t.after(async () => {
    hub.stop();
    await server.close();
    temp.cleanup();
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`http://127.0.0.1:${server.port}/events?swarm=${a.id}`, {
    headers: { "Last-Event-ID": String(before) },
    signal: controller.signal,
  });
  assert.ok(response.body);
  const reader = response.body.getReader();
  let text = "";
  while (!text.includes("event: retention-gap")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += new TextDecoder().decode(chunk.value);
  }
  assert.match(text, /"recovery":"snapshot"/);
  await reader.cancel();
  const other = await openSse(`http://127.0.0.1:${server.port}/events?swarm=${b.id}`, {
    "Last-Event-ID": String(before),
  });
  t.after(() => other.close());
  insertEvent(temp.db, b.id, "session.appended", { agent: "John", newestCursor: "3" }, T0 + 2);
  clock.advance(EVENTS_TAIL_MS);
  await other.next(isType("session.appended"));
  assert.ok(other.frames.every((item) => item.event === null || item.event.swarmId === b.id));
});

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  EVENTS_RETENTION_MS,
  RUN_LOCK_STALE_MS,
  SERVER_HOST_HEARTBEAT_MS,
  SERVER_HOST_POLL_MS,
  STALE_SWEEP_INTERVAL_MS,
} from "../../src/constants.js";
import { ServerHost, type ServerHostOptions } from "../../src/server/host.js";
import type { SwarmDb } from "../../src/store/db.js";
import { readServerHost } from "../../src/store/locks.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";
import { createUiFixture, WAIT_MS, waitFor } from "./helpers.js";

const HOST_A = 1001;
const HOST_B = 1002;

interface Setup {
  temp: TempDb;
  clock: FakeClock;
  live: Set<number>;
  errors: string[];
  host(options?: Partial<ServerHostOptions>): ServerHost;
}

function setup(t: TestContext, start = Date.now()): Setup {
  const temp = createTempDb();
  const ui = createUiFixture();
  const clock = new FakeClock(start);
  const live = new Set([HOST_A, HOST_B, process.pid]);
  const errors: string[] = [];
  const hosts: ServerHost[] = [];
  t.after(async () => {
    for (const host of hosts) await host.stop();
    temp.cleanup();
    ui.cleanup();
  });
  return {
    temp,
    clock,
    live,
    errors,
    host(options = {}) {
      const host = new ServerHost({
        cwd: temp.cwd,
        uiDir: ui.dir,
        getDb: () => temp.db,
        clock,
        alive: (pid) => live.has(pid),
        ports: () => ({ candidates: [0], explicit: false }),
        onError: (message) => errors.push(message),
        ...options,
      });
      hosts.push(host);
      return host;
    },
  };
}

function hostRow(db: SwarmDb): { pid: number; port: number; heartbeatAt: number } {
  const row = db.sql.prepare("SELECT pid, port, heartbeat_at FROM server_host WHERE id = 1").get();
  return { pid: Number(row?.pid), port: Number(row?.port), heartbeatAt: Number(row?.heartbeat_at) };
}

async function isServing(url: string | null): Promise<boolean> {
  if (url === null) return false;
  return fetch(url).then(
    (response) => response.ok,
    () => false,
  );
}

async function until(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function occupy(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) resolve({ port: address.port, server });
    });
  });
}

describe("election", () => {
  it("lets exactly one host serve; the other takes over on its next poll with the same port", async (t) => {
    const { temp, clock, host } = setup(t);
    const a = host({ pid: HOST_A });
    const b = host({ pid: HOST_B });
    a.start();
    const url = await a.ensure();
    assert.ok(await isServing(url));
    b.start();
    assert.equal(await b.ensure(), url, "the loser reports the winner's URL");
    assert.equal(hostRow(temp.db).pid, HOST_A);

    const port = hostRow(temp.db).port;
    await a.stop();
    assert.equal(await isServing(url), false);
    assert.deepEqual(hostRow(temp.db), { pid: HOST_A, port, heartbeatAt: 0 }, "released, port kept");
    clock.advance(SERVER_HOST_POLL_MS - 1);
    assert.equal(hostRow(temp.db).pid, HOST_A);
    clock.advance(1);
    await waitFor(() => b.boardUrl(), undefined, "takeover");
    assert.deepEqual([hostRow(temp.db).pid, hostRow(temp.db).port], [HOST_B, port]);
    assert.equal(b.boardUrl(), url);
    assert.ok(await isServing(url));
  });

  it("closes the old server when another process took the row over", async (t) => {
    const { temp, clock, live, host } = setup(t);
    const a = host({ pid: HOST_A });
    const urlA = await a.ensure();
    live.delete(HOST_A);
    const urlB = await host({ pid: HOST_B }).ensure();
    assert.notEqual(urlB, urlA);
    assert.equal(hostRow(temp.db).pid, HOST_B);
    assert.ok(await isServing(urlA), "A has not noticed yet");
    clock.advance(SERVER_HOST_HEARTBEAT_MS);
    await until(async () => !(await isServing(urlA)), "A closes its server");
    assert.equal(a.boardUrl(), urlB);
    assert.ok(await isServing(urlB));
  });

  it("starts lazily: nothing happens until the DB exists", async (t) => {
    const { temp, clock, errors, host } = setup(t);
    let db: SwarmDb | null = null;
    const lazy = host({ getDb: () => db });
    lazy.start();
    assert.equal(await lazy.ensure(), null);
    assert.equal(lazy.boardUrl(), null);
    db = temp.db;
    clock.advance(SERVER_HOST_POLL_MS);
    const url = await waitFor(() => lazy.boardUrl(), undefined, "lazy host");
    assert.ok(await isServing(url));
    assert.deepEqual(errors, []);
  });

  it("hands the row over synchronously with releaseSync", async (t) => {
    const { temp, clock, live, host } = setup(t);
    const a = host({ pid: HOST_A });
    await a.ensure();
    const alive = (pid: number) => live.has(pid);
    assert.equal(readServerHost(temp.db, clock.now(), alive)?.pid, HOST_A);
    a.releaseSync();
    assert.equal(readServerHost(temp.db, clock.now(), alive), null);
    assert.equal(hostRow(temp.db).heartbeatAt, 0);
  });
});

describe("ports", () => {
  it("reports a taken explicit port once, releases, and serves once it is free", async (t) => {
    const { temp, clock, errors, host } = setup(t);
    const busy = await occupy();
    const explicit = host({ ports: () => ({ candidates: [busy.port], explicit: true }) });
    explicit.start();
    assert.equal(await explicit.ensure(), null);
    const message = `Board port ${busy.port} is in use (configured in .pi/swarm/settings.json or PI_SWARM_PORT).`;
    assert.deepEqual(errors, [message]);
    assert.equal(hostRow(temp.db).heartbeatAt, 0, "released for other processes");
    clock.advance(SERVER_HOST_POLL_MS);
    assert.equal(await explicit.ensure(), null);
    assert.deepEqual(errors, [message], "reported once");
    await new Promise((resolve) => busy.server.close(resolve));
    assert.equal(await explicit.ensure(), `http://127.0.0.1:${busy.port}`);
  });

  it("treats settings.json port as explicit", async (t) => {
    const { temp, errors, host } = setup(t);
    const busy = await occupy();
    t.after(() => busy.server.close());
    writeFileSync(path.join(temp.db.dataDir, "settings.json"), JSON.stringify({ port: busy.port }));
    assert.equal(await host({ ports: undefined }).ensure(), null);
    assert.deepEqual(errors, [
      `Board port ${busy.port} is in use (configured in .pi/swarm/settings.json or PI_SWARM_PORT).`,
    ]);
  });

  it("reports invalid settings instead of hosting", async (t) => {
    const { temp, errors, host } = setup(t);
    writeFileSync(path.join(temp.db.dataDir, "settings.json"), "{broken");
    assert.equal(await host({ ports: undefined }).ensure(), null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^settings\.json: invalid JSON/);
  });

  it("falls back past busy ports when not explicit, and reports when all are busy", async (t) => {
    const { errors, host } = setup(t);
    const first = await occupy();
    const second = await occupy();
    t.after(() => {
      first.server.close();
      second.server.close();
    });
    const none = host({ ports: () => ({ candidates: [first.port, second.port], explicit: false }) });
    assert.equal(await none.ensure(), null);
    assert.deepEqual(errors, [`No free board port: ${first.port}, ${second.port} are all in use.`]);
    const fallback = host({ ports: () => ({ candidates: [first.port, second.port, 0], explicit: false }) });
    const url = await fallback.ensure();
    assert.ok(url !== null && !url.endsWith(`:${first.port}`) && !url.endsWith(`:${second.port}`));
  });
});

describe("maintenance while hosting", () => {
  it("sweeps swarms with stale run locks every STALE_SWEEP_INTERVAL_MS", async (t) => {
    const { temp, clock, host } = setup(t, T0);
    const swarmId = seedSwarm(temp.db, { now: T0 }).id;
    const status = () => String(temp.db.sql.prepare("SELECT status FROM swarms WHERE id = ?").get(swarmId)?.status);
    await host().ensure();
    assert.equal(status(), "starting");
    const sweepsUntilStale = Math.floor(RUN_LOCK_STALE_MS / STALE_SWEEP_INTERVAL_MS);
    clock.advance(sweepsUntilStale * STALE_SWEEP_INTERVAL_MS);
    assert.equal(status(), "starting", "the lock is exactly at the stale limit, still fresh");
    clock.advance(STALE_SWEEP_INTERVAL_MS);
    assert.equal(status(), "interrupted");
  });

  it("prunes outbox rows older than the retention", async (t) => {
    const { temp, host } = setup(t, T0 + EVENTS_RETENTION_MS + 1);
    seedSwarm(temp.db, { now: T0, runnerPid: 2 ** 30 });
    const oldEvents = () =>
      Number(temp.db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at = ?").get(T0)?.n);
    assert.ok(oldEvents() > 0);
    await host().ensure();
    assert.equal(oldEvents(), 0);
  });
});

import assert from "node:assert/strict";
import { createReadStream, unlinkSync } from "node:fs";
import { Readable } from "node:stream";
import { test } from "node:test";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { createApiRoutes } from "../../src/server/api.js";
import { startBoardServer } from "../../src/server/http.js";
import { SessionReader, SessionWatcher } from "../../src/server/sessions.js";
import { SseHub } from "../../src/server/sse.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";
import { createUiFixture } from "./helpers.js";

for (const failure of ["vanished", "read error"]) {
  test(`static stream handles ${failure} after stat`, async (t) => {
    const ui = createUiFixture();
    const errors: string[] = [];
    const server = await startBoardServer({
      candidates: [0],
      uiDir: ui.dir,
      routes: [],
      onError: (message) => errors.push(message),
      readFile(file) {
        if (!file.endsWith(".js")) return createReadStream(file);
        if (failure === "vanished") {
          unlinkSync(file);
          return createReadStream(file);
        }
        return new Readable({
          read() {
            this.destroy(new Error("disk read failed"));
          },
        });
      },
    });
    t.after(async () => {
      await server.close();
      ui.cleanup();
    });
    const base = `http://127.0.0.1:${server.port}`;
    // Once streaming starts, a file error terminates the response instead of sending a second set of headers.
    await assert.rejects(async () => {
      await (await fetch(`${base}/assets/index-AbC123.js`)).text();
    });
    assert.equal((await fetch(base)).status, 200);
    if (failure === "read error") assert.match(errors.join(), /disk read failed/);
    else assert.match(errors.join(), /ENOENT/);
  });
}

test("request and API failures use the injected reporter and keep serving", async (t) => {
  const temp = createTempDb();
  const ui = createUiFixture();
  const clock = new FakeClock();
  const errors: string[] = [];
  const onError = (message: string) => errors.push(message);
  const api = createApiRoutes({ db: temp.db, clock, sessions: new SessionReader(), onError });
  const server = await startBoardServer({
    candidates: [0],
    uiDir: ui.dir,
    onError,
    routes: [
      async (_req, _res, url) => {
        if (url.pathname === "/throw") throw new Error("route failed");
        return false;
      },
      api,
    ],
  });
  t.after(async () => {
    await server.close();
    temp.cleanup();
    ui.cleanup();
  });
  temp.db.sql.exec("DROP TABLE events; DROP TABLE swarms;");
  const base = `http://127.0.0.1:${server.port}`;
  for (const path of ["/throw", "/api/swarms"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal", message: "Internal server error." });
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /route failed/);
  assert.match(errors[1], /API error/);
  assert.equal((await fetch(base)).status, 200);
});

test("tail DB failure reports, ends streams, and releases session watches without throwing from the timer", async (t) => {
  const temp = createTempDb();
  const clock = new FakeClock(Date.now());
  const id = seedSwarm(temp.db, { now: clock.now(), agents: ["Maria"] }).id;
  const errors: string[] = [];
  let watches = 0;
  class Watcher extends SessionWatcher {
    override watch(): () => void {
      watches++;
      return () => {
        watches--;
      };
    }
  }
  const hub = new SseHub({
    db: temp.db,
    clock,
    watcher: new Watcher({ reader: new SessionReader(), clock }),
    onError: (message) => errors.push(message),
  });
  hub.start();
  const server = await startBoardServer({ candidates: [0], uiDir: temp.cwd, routes: [hub.route] });
  t.after(async () => {
    hub.stop();
    await server.close();
    temp.cleanup();
  });
  const response = await fetch(`http://127.0.0.1:${server.port}/events?swarm=${id}`);
  assert.equal(watches, 1);
  temp.db.sql.exec("DROP TABLE events");
  assert.doesNotThrow(() => clock.advance(EVENTS_TAIL_MS));
  await response.text();
  assert.equal(watches, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SSE failed.*events/);
  assert.doesNotThrow(() => clock.advance(EVENTS_TAIL_MS));
  assert.equal(errors.length, 1, "repeated DB failures are reported once");
});

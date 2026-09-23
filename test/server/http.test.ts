import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer, type Server } from "node:net";
import { after, before, describe, it } from "node:test";
import { PortsInUseError, startBoardServer, type BoardServer } from "../../src/server/http.js";
import { createUiFixture, OUTSIDE_SECRET, UI_ASSET, UI_INDEX } from "./helpers.js";

const ui = createUiFixture();
let board: BoardServer;
let base: string;

before(async () => {
  const route = async (_req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname !== "/api/ping") return false;
    res.end("pong");
    return true;
  };
  board = await startBoardServer({ candidates: [0], uiDir: ui.dir, routes: [route] });
  base = `http://127.0.0.1:${board.port}`;
});
after(async () => {
  await board.close();
  ui.cleanup();
});

/** Sends the path as is (fetch would normalise `..` away). */
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: board.port, path }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("static files", () => {
  it("serves the app shell without caching", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(await response.text(), UI_INDEX);
  });

  it("serves hashed assets as immutable with their content type", async () => {
    const response = await fetch(`${base}/assets/index-AbC123.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(await response.text(), UI_ASSET);
    const svg = await fetch(`${base}/favicon.svg`);
    assert.deepEqual(
      [svg.headers.get("content-type"), svg.headers.get("cache-control")],
      ["image/svg+xml", "no-cache"],
    );
  });

  it("answers HEAD without a body", async () => {
    const response = await fetch(`${base}/assets/index-AbC123.js`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(UI_ASSET)));
    assert.equal(await response.text(), "");
  });

  it("answers client-side routes with index.html", async () => {
    for (const path of ["/s/3/agents", "/s/3/work/Maria", "/unknown.txt"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), UI_INDEX, path);
    }
  });

  it("never serves files outside ui_dist", async () => {
    assert.equal(await (await fetch(`${base}/../secret.txt`)).text(), UI_INDEX);
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%5csecret.txt"]) {
      const response = await rawGet(path);
      assert.ok([200, 400].includes(response.status), path);
      assert.notEqual(response.body, OUTSIDE_SECRET, path);
    }
    assert.equal((await rawGet("/%E0%A4%A")).status, 400);
    assert.equal((await rawGet("/%00")).status, 400);
    assert.equal((await rawGet(`/${"a".repeat(300)}`)).status, 404);
    assert.equal((await fetch(base)).status, 200, "malformed paths do not kill the server");
  });

  it("routes first, then a JSON 404 for unknown /api and /events paths and non-GET methods", async () => {
    assert.equal(await (await fetch(`${base}/api/ping`)).text(), "pong");
    for (const [method, path] of [
      ["GET", "/api/missing"],
      ["GET", "/events"],
      ["POST", "/s/3/agents"],
    ]) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: "not_found", message: `No route for ${method} ${path}.` });
    }
  });

  it("explains a missing build", async (t) => {
    const empty = createUiFixture();
    t.after(() => empty.cleanup());
    rmSync(`${empty.dir}/index.html`);
    const server = await startBoardServer({ candidates: [0], uiDir: empty.dir, routes: [] });
    t.after(() => server.close());
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /not built/);
  });
});

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

describe("port candidates", () => {
  it("falls back to the next candidate when a port is busy", async (t) => {
    const busy = await occupy();
    t.after(() => busy.server.close());
    const server = await startBoardServer({ candidates: [busy.port, 0], uiDir: ui.dir, routes: [] });
    t.after(() => server.close());
    assert.notEqual(server.port, busy.port);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/`)).status, 200);
  });

  it("rejects with PortsInUseError when every candidate is busy", async (t) => {
    const first = await occupy();
    const second = await occupy();
    t.after(() => {
      first.server.close();
      second.server.close();
    });
    await assert.rejects(
      startBoardServer({ candidates: [first.port, second.port], uiDir: ui.dir, routes: [] }),
      (error: unknown) => error instanceof PortsInUseError && error.ports.join() === `${first.port},${second.port}`,
    );
  });
});

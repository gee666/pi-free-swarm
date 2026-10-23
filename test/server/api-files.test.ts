import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FilePreview, TextFilePreview } from "../../src/api-file-types.js";
import type { ApiErrorBody } from "../../src/api-types.js";
import { FILE_PREVIEW_TEXT_BYTES } from "../../src/server/project-files.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("file preview HTTP pages preserve source and visible versioned continuation", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const original = "\uFEFF \n" + "🙂漢\n".repeat(10_000) + "END  ";
  writeFileSync(path.join(board.temp.cwd, "long source.md"), original);
  const route = `${board.base}/api/swarms/${swarm.id}/files/preview?path=${encodeURIComponent("long source.md")}`;
  const response = await getJson<TextFilePreview>(route);
  assert.equal(response.status, 200);
  assert.equal(response.body.kind, "text");
  assert.equal(response.body.complete, false);
  assert.ok(response.body.nextOffset);
  assert.ok(Buffer.byteLength(response.body.text) <= FILE_PREVIEW_TEXT_BYTES);
  const tail = await getJson<TextFilePreview>(
    `${route}&offset=${response.body.nextOffset}&version=${encodeURIComponent(response.body.version)}`,
  );
  assert.equal(tail.status, 200);
  assert.equal(tail.body.complete, true);
  assert.equal(tail.body.nextOffset, null);
  assert.equal(response.body.text + tail.body.text, original);
  writeFileSync(path.join(board.temp.cwd, "long source.md"), "Changed");
  assert.equal(
    (await getJson<ApiErrorBody>(`${route}&offset=1&version=${encodeURIComponent(response.body.version)}`)).status,
    409,
  );
});

test("file HTTP routes serve safe raw raster content and keep executable formats as JSON text", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  writeFileSync(path.join(board.temp.cwd, "image.png"), PNG);
  writeFileSync(path.join(board.temp.cwd, "page.html"), "<script>alert('must stay text')</script>");
  const base = `${board.base}/api/swarms/${swarm.id}/files`;
  const image = await getJson<FilePreview>(`${base}/preview?path=image.png`);
  assert.equal(image.status, 200);
  assert.equal(image.body.kind, "image");
  assert.ok(image.body.kind === "image");
  const raw = await fetch(`${board.base}${image.body.url}`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("content-type"), "image/png");
  assert.equal(raw.headers.get("cache-control"), "no-store");
  assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
  assert.equal(raw.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.match(raw.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), PNG);
  const html = await getJson<TextFilePreview>(`${base}/preview?path=page.html`);
  assert.equal(html.body.kind, "text");
  assert.equal(html.body.mimeType, "text/plain");
  assert.match(html.body.text, /<script>/);
  assert.equal(
    (await getJson<ApiErrorBody>(`${base}/content?path=page.html&version=${encodeURIComponent(html.body.version)}`))
      .status,
    415,
  );
  assert.equal((await getJson<ApiErrorBody>(`${base}/content?path=image.png`)).status, 400);
});

test("file HTTP errors reject missing scope, paths and unbounded/invalid positions without disclosing files", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const base = `${board.base}/api/swarms/${swarm.id}/files/preview`;
  assert.equal((await getJson<ApiErrorBody>(base)).body.field, "path");
  assert.equal(
    (
      await getJson<ApiErrorBody>(
        `${base}?path=${encodeURIComponent(path.resolve(board.temp.cwd, "..", "outside.txt"))}`,
      )
    ).status,
    403,
  );
  assert.equal((await getJson<ApiErrorBody>(`${base}?path=missing.txt`)).status, 404);
  assert.equal(
    (await getJson<ApiErrorBody>(`${board.base}/api/swarms/999999/files/preview?path=missing.txt`)).status,
    404,
  );
  writeFileSync(path.join(board.temp.cwd, "read.txt"), "data");
  for (const offset of ["-1", "0.5", "Infinity", "9999999999999999999"]) {
    const response = await getJson<ApiErrorBody>(`${base}?path=read.txt&offset=${offset}`);
    assert.equal(response.status, 400);
    assert.equal(response.body.field, "offset");
  }
});

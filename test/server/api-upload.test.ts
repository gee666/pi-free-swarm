import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { request } from "node:http";
import { test } from "node:test";
import type { FilePreview, TextFilePreview } from "../../src/api-file-types.js";
import { FILE_PREVIEW_IMAGE_BYTES } from "../../src/server/project-files.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

function upload(
  base: string,
  swarmId: number,
  name: string,
  bytes: Uint8Array | string,
  contentType = "application/octet-stream",
) {
  return fetch(`${base}/api/swarms/${swarmId}/files/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof bytes === "string" ? bytes : new Uint8Array(bytes).buffer,
  });
}

async function uploadedPath(response: Response): Promise<string> {
  assert.equal(response.status, 201);
  const body: unknown = await response.json();
  assert.ok(body !== null && typeof body === "object" && "path" in body && typeof body.path === "string");
  assert.match(body.path, /^tmp\/swarm-upload-[^/]+\/[^/]+$/);
  assert.equal(path.isAbsolute(body.path), false);
  return body.path;
}

const PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"),
);

test("User uploads preserve bytes in unique project tmp paths and remain previewable", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const text = "Unicode evidence 🙂\nExact source.";
  const first = await uploadedPath(await upload(board.base, swarm.id, "review notes.md", text));
  const second = await uploadedPath(await upload(board.base, swarm.id, "review notes.md", "different"));
  assert.notEqual(first, second);
  assert.equal(readFileSync(path.join(board.temp.cwd, first), "utf8"), text);
  assert.equal(readFileSync(path.join(board.temp.cwd, second), "utf8"), "different");
  assert.match(path.basename(first), /^review_notes\.md$/);
  const preview = await getJson<TextFilePreview>(
    `${board.base}/api/swarms/${swarm.id}/files/preview?path=${encodeURIComponent(first)}`,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.kind, "text");
  assert.equal(preview.body.text, text);
  const image = await uploadedPath(await upload(board.base, swarm.id, "picture.png", PNG));
  assert.deepEqual(readFileSync(path.join(board.temp.cwd, image)), Buffer.from(PNG));
  const imagePreview = await getJson<FilePreview>(
    `${board.base}/api/swarms/${swarm.id}/files/preview?path=${encodeURIComponent(image)}`,
  );
  assert.equal(imagePreview.status, 200);
  assert.ok(imagePreview.body.kind === "image");
  const raw = await fetch(`${board.base}${imagePreview.body.url}`);
  assert.equal(raw.status, 200);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), Buffer.from(PNG));
  for (const table of ["posts", "comments", "messages", "post_subscriptions"]) {
    assert.equal(board.temp.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  }
});

test("empty files and binary documents preserve their contents without promising unsupported previews", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const empty = await uploadedPath(await upload(board.base, swarm.id, "empty.txt", ""));
  assert.equal(readFileSync(path.join(board.temp.cwd, empty)).length, 0);
  const binary = new Uint8Array([0, 255, 128, 13, 10]);
  const document = await uploadedPath(await upload(board.base, swarm.id, "report.docx", binary));
  assert.deepEqual(readFileSync(path.join(board.temp.cwd, document)), Buffer.from(binary));
  const preview = await getJson(
    `${board.base}/api/swarms/${swarm.id}/files/preview?path=${encodeURIComponent(document)}`,
  );
  assert.equal(preview.status, 415);
});

test("upload rejects unsafe names, missing swarm and browser-simple content types without creating files", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  for (const name of [
    "",
    "..",
    ".",
    "../escape.txt",
    "nested/file.txt",
    "nested\\file.txt",
    "/absolute.txt",
    "bad\0name.txt",
    "bad\nname.txt",
    "x".repeat(1024),
  ]) {
    assert.equal((await upload(board.base, swarm.id, name, "data")).status, 400, name);
  }
  const missingName = await fetch(`${board.base}/api/swarms/${swarm.id}/files/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: "data",
  });
  assert.equal(missingName.status, 400);
  for (const contentType of ["text/plain", "application/json", "multipart/form-data"]) {
    assert.equal((await upload(board.base, swarm.id, "safe.txt", "data", contentType)).status, 400);
  }
  assert.equal((await upload(board.base, 999999, "safe.txt", "data")).status, 404);
  assert.equal(existsSync(path.join(board.temp.cwd, "tmp")), false);
});

test("oversized upload is rejected without persisting partial files", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  assert.equal(
    (await upload(board.base, swarm.id, "large.bin", new Uint8Array(FILE_PREVIEW_IMAGE_BYTES + 1))).status,
    413,
  );
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const req = request(
      `${board.base}/api/swarms/${swarm.id}/files/upload?name=chunked.bin`,
      { method: "POST", headers: { "Content-Type": "application/octet-stream" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.write(new Uint8Array(FILE_PREVIEW_IMAGE_BYTES));
    req.end(new Uint8Array([1]));
  });
  assert.equal(chunkedStatus, 413);
  const directory = path.join(board.temp.cwd, "tmp");
  if (existsSync(directory)) assert.deepEqual(readdirSync(directory), []);
});

test("upload accepts exactly the configured byte ceiling", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const swarm = seedSwarm(board.temp.db);
  const bytes = new Uint8Array(FILE_PREVIEW_IMAGE_BYTES);
  bytes[bytes.length - 1] = 255;
  const uploaded = await uploadedPath(await upload(board.base, swarm.id, "boundary.bin", bytes));
  assert.deepEqual(readFileSync(path.join(board.temp.cwd, uploaded)), Buffer.from(bytes));
});

test("upload rejects a project tmp symlink without writing outside the project", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const outside = mkdtempSync(path.resolve("tmp/upload-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, path.join(board.temp.cwd, "tmp"), "dir");
  const swarm = seedSwarm(board.temp.db);
  assert.equal((await upload(board.base, swarm.id, "safe.txt", "data")).status, 403);
  assert.deepEqual(readdirSync(outside), []);
});

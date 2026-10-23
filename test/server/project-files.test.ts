import assert from "node:assert/strict";
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FILE_PREVIEW_IMAGE_BYTES, previewProjectFile, readProjectImage } from "../../src/server/project-files.js";
import { createTempDb } from "../helpers/temp-db.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("text preview preserves exact UTF-8 bytes, BOM and whitespace across bounded pages", async () => {
  const temp = createTempDb();
  try {
    const original = "\uFEFF \n" + "🙂漢字\n".repeat(20) + "TAIL  ";
    writeFileSync(path.join(temp.cwd, "source.ts"), original);
    let page = await previewProjectFile(temp.cwd, "source.ts", { textBytes: 13 });
    assert.equal(page.kind, "text");
    const parts: string[] = [];
    const version = page.version;
    let calls = 0;
    while (page.kind === "text") {
      assert.ok(Buffer.byteLength(page.text) <= 13);
      assert.equal(page.totalBytes, Buffer.byteLength(original));
      assert.equal(page.version, version);
      parts.push(page.text);
      if (page.nextOffset === null) {
        assert.equal(page.complete, true);
        break;
      }
      assert.equal(page.complete, false);
      assert.ok(page.nextOffset > page.offset);
      assert.ok(++calls < 100);
      page = await previewProjectFile(temp.cwd, "source.ts", { offset: page.nextOffset, version, textBytes: 13 });
    }
    assert.equal(parts.join(""), original);
    assert.equal(page.path, "source.ts");
  } finally {
    temp.cleanup();
  }
});

test("project aliases resolve safely while traversal, prefix lookalikes and outside symlinks are rejected", async () => {
  const temp = createTempDb();
  const outside = mkdtempSync(path.resolve("tmp/file-preview-outside-"));
  const alias = path.join(outside, "project-alias");
  try {
    writeFileSync(path.join(temp.cwd, "inside.txt"), "inside");
    writeFileSync(path.join(outside, "secret.txt"), "MUST-NOT-BE-RETURNED");
    symlinkSync(outside, path.join(temp.cwd, "escape"), "junction");
    symlinkSync(temp.cwd, alias, "junction");
    const fromAlias = await previewProjectFile(alias, path.join(alias, "inside.txt"));
    assert.equal(fromAlias.path, "inside.txt");
    const fromReal = await previewProjectFile(alias, path.join(temp.cwd, "inside.txt"));
    assert.equal(fromReal.kind, "text");
    for (const reference of [
      path.join(outside, "secret.txt"),
      path.relative(temp.cwd, path.join(outside, "secret.txt")),
      "escape/secret.txt",
    ]) {
      await assert.rejects(previewProjectFile(temp.cwd, reference), /Only project files|symlink escapes/);
    }
    await assert.rejects(previewProjectFile(temp.cwd, "file:///etc/passwd"), /not a URL/);
    await assert.rejects(previewProjectFile(temp.cwd, "\0bad"), /project file path/);
    await assert.rejects(previewProjectFile(temp.cwd, "."), /Only regular files/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    temp.cleanup();
  }
});

test("known source changes and invalid ranges fail without returning a mixed preview", async () => {
  const temp = createTempDb();
  try {
    const file = path.join(temp.cwd, "change.md");
    writeFileSync(file, "first source 中文");
    const first = await previewProjectFile(temp.cwd, "change.md", { textBytes: 4 });
    writeFileSync(file, "a different, longer source");
    await assert.rejects(
      previewProjectFile(temp.cwd, "change.md", { offset: 4, version: first.version }),
      /File changed/,
    );
    for (const offset of [-1, 1.5, Number.NaN, 1_000_000]) {
      await assert.rejects(previewProjectFile(temp.cwd, "change.md", { offset }), /offset/);
    }
    writeFileSync(file, "🙂text");
    await assert.rejects(previewProjectFile(temp.cwd, "change.md", { offset: 1 }), /not UTF-8/);
    writeFileSync(path.join(temp.cwd, "binary.bin"), Buffer.from([0xff, 0xfe, 0xff]));
    await assert.rejects(previewProjectFile(temp.cwd, "binary.bin"), /not UTF-8/);
    await assert.rejects(previewProjectFile(temp.cwd, "missing.txt"), /not found/);
    writeFileSync(path.join(temp.cwd, "empty.txt"), "");
    const empty = await previewProjectFile(temp.cwd, "empty.txt");
    assert.ok(empty.kind === "text");
    assert.equal(empty.text, "");
    assert.equal(empty.totalBytes, 0);
    assert.equal(empty.complete, true);
    assert.equal(empty.nextOffset, null);
    mkdirSync(path.join(temp.cwd, "directory"));
    await assert.rejects(previewProjectFile(temp.cwd, "directory"), /Only regular files/);
  } finally {
    temp.cleanup();
  }
});

test("raster images are bounded raw content and SVG or HTML stay inert text", async () => {
  const temp = createTempDb();
  try {
    writeFileSync(path.join(temp.cwd, "image.png"), PNG);
    const image = await previewProjectFile(temp.cwd, "image.png");
    assert.equal(image.kind, "image");
    assert.equal(image.mimeType, "image/png");
    assert.deepEqual((await readProjectImage(temp.cwd, "image.png", image.version)).bytes, PNG);
    writeFileSync(path.join(temp.cwd, "unsafe.svg"), '<svg onload="alert(1)"></svg>');
    assert.equal((await previewProjectFile(temp.cwd, "unsafe.svg")).kind, "text");
    await assert.rejects(
      readProjectImage(temp.cwd, "unsafe.svg", (await previewProjectFile(temp.cwd, "unsafe.svg")).version),
      /Only supported raster/,
    );
    writeFileSync(path.join(temp.cwd, "page.html"), "<script>alert(1)</script>");
    assert.equal((await previewProjectFile(temp.cwd, "page.html")).mimeType, "text/plain");
    const large = path.join(temp.cwd, "large.png");
    const fd = openSync(large, "w");
    try {
      ftruncateSync(fd, FILE_PREVIEW_IMAGE_BYTES + 1);
    } finally {
      closeSync(fd);
    }
    await assert.rejects(previewProjectFile(temp.cwd, "large.png"), /16MiB preview limit/);
  } finally {
    temp.cleanup();
  }
});

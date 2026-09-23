// Own file: it wraps FileHandle.prototype.read for the whole process to count the bytes the reader touches.
import assert from "node:assert/strict";
import fs from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { SessionReader } from "../../src/server/sessions.js";
import { headerLine, tempDir, turnItemIds, turnLines } from "../fixtures/sessions/helpers.js";

const TURNS = 5_000; // 20,001 entries

async function countReadBytes(file: string): Promise<{ total(): number; restore(): void }> {
  const handle = await open(file);
  const prototype: { read: FileHandle["read"] } = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype.read;
  let total = 0;
  prototype.read = async function (this: FileHandle, ...args: unknown[]) {
    const result = await Reflect.apply(original, this, args);
    total += result.bytesRead;
    return result;
  };
  return { total: () => total, restore: () => (prototype.read = original) };
}

test("a 20k-entry session pages from the end without reading the whole file", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  const chunks = [headerLine()];
  for (let k = 0; k < TURNS; k++) chunks.push(turnLines(k));
  fs.writeFileSync(file, chunks.join(""));
  const size = fs.statSync(file).size;
  const counter = await countReadBytes(file);
  t.after(() => counter.restore());
  const expected = turnItemIds(TURNS);
  const reader = new SessionReader();

  const started = performance.now();
  let page = await reader.readPage("Maria", file, { limit: 50 });
  const newest = page.newestCursor ?? undefined;
  const pageItems = [...page.items];
  for (let i = 0; i < 9; i++) {
    page = await reader.readPage("Maria", file, { before: page.olderCursor ?? undefined, limit: 50 });
    pageItems.push(...page.items);
  }
  const elapsed = performance.now() - started;
  assert.deepEqual(
    pageItems.map((item) => item.id),
    expected.slice(0, pageItems.length),
  );
  // Ten pages of 50 entries are ~2.5% of the file; the index reads 64 KB chunks, so allow a few of them.
  assert.ok(counter.total() > 0 && counter.total() < size / 10, `read ${counter.total()} of ${size} bytes`);
  assert.ok(elapsed < 2_000, `took ${elapsed} ms`);

  // Growth is indexed incrementally: an `after` read touches only the new bytes and the open turn.
  const before = counter.total();
  fs.appendFileSync(file, turnLines(TURNS));
  const latest = await reader.readPage("Maria", file, { after: newest, limit: 50 });
  assert.deepEqual(
    latest.items.map((item) => item.id),
    turnItemIds(TURNS + 1).slice(0, 3),
  );
  assert.ok(counter.total() - before < 8 * 1024, `growth read ${counter.total() - before} bytes`);
});

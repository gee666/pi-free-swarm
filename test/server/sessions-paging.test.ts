import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { SessionItem } from "../../src/api-types.js";
import { SessionCursorError, SessionReader } from "../../src/server/sessions.js";
import {
  assistantLine,
  contextEditLine,
  customLine,
  errorLine,
  headerLine,
  readAllPages,
  tempDir,
  toolCall,
  toolResultLine,
  turnItemIds,
  turnLines,
  userLine,
} from "../fixtures/sessions/helpers.js";

function writeTurns(file: string, from: number, to: number): void {
  let text = from === 0 ? headerLine() : "";
  for (let k = from; k < to; k++) text += turnLines(k);
  fs.appendFileSync(file, text);
}

function toolCallOf(items: SessionItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id);
  assert.equal(item?.kind, "tool_call");
  return item?.kind === "tool_call" ? item : undefined;
}

test("a missing file or directory reads as an empty page with null cursors", async (t) => {
  const reader = new SessionReader();
  const dir = tempDir(t);
  const expected = { agent: "Maria", items: [], olderCursor: null, newestCursor: null };
  assert.deepEqual(await reader.readPage("Maria", path.join(dir, "session.jsonl"), { limit: 50 }), expected);
  assert.deepEqual(await reader.readPage("Maria", path.join(dir, "Maria", "session.jsonl"), { limit: 50 }), expected);
  assert.equal(await reader.newestCursor(path.join(dir, "session.jsonl")), null);
});

test("reverse pages have no gaps or duplicates and pair tool calls with results on newer pages", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  writeTurns(file, 0, 30);
  const reader = new SessionReader();
  // 7 entries per page never aligns with the 4-entry turns, so calls and results land on different pages.
  for (const limit of [1, 3, 7, 50, 200]) {
    const items = await readAllPages(reader, file, limit);
    assert.deepEqual(
      items.map((item) => item.id),
      turnItemIds(30),
      `limit ${limit}`,
    );
    for (let k = 0; k < 30; k++) assert.equal(toolCallOf(items, `c${k}:0`)?.result, `output ${k}`);
  }
  const newest = await reader.readPage("Maria", file, { limit: 3 });
  assert.equal(newest.newestCursor, await reader.newestCursor(file));
  const older = await reader.readPage("Maria", file, { before: newest.olderCursor ?? undefined, limit: 3 });
  assert.notEqual(older.newestCursor, newest.newestCursor);
});

test("entries that show nothing never leave a page empty mid-file", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  let text = headerLine() + userLine("u1", "hello") + assistantLine("a1", [{ type: "text", text: "hi" }]);
  for (let i = 0; i < 10; i++) text += customLine(`x${i}`);
  fs.writeFileSync(file, text);
  const page = await new SessionReader().readPage("Maria", file, { limit: 3 });
  assert.deepEqual(
    page.items.map((item) => item.id),
    ["a1:0", "u1:0"],
  );
  assert.notEqual(page.olderCursor, null);
});

test("after returns only newer entries, in chunks of limit, and nothing when up to date", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  writeTurns(file, 0, 5);
  const reader = new SessionReader();
  const first = await reader.readPage("Maria", file, { limit: 50 });
  assert.ok(first.newestCursor);
  writeTurns(file, 5, 8);
  // Clients upsert by id: a chunk may repeat an entry of the previous one whose tool result arrived.
  const collected: SessionItem[] = [];
  let cursor = first.newestCursor;
  for (;;) {
    const page = await reader.readPage("Maria", file, { after: cursor, limit: 5 });
    assert.ok(page.newestCursor);
    if (page.items.length === 0) {
      assert.equal(page.newestCursor, cursor);
      break;
    }
    const fresh = page.items.filter((item) => !collected.some((known) => known.id === item.id));
    for (const item of page.items) {
      const at = collected.findIndex((known) => known.id === item.id);
      if (at >= 0) collected[at] = item;
    }
    collected.unshift(...fresh);
    cursor = page.newestCursor;
  }
  assert.deepEqual(
    collected.map((item) => item.id),
    turnItemIds(8).slice(0, 9),
  );
  for (const k of [5, 6, 7]) assert.equal(toolCallOf(collected, `c${k}:0`)?.result, `output ${k}`);
  assert.equal(cursor, await reader.newestCursor(file));
});

test("after repeats a running tool call once its result arrives, and an error once it is retried", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  const start = Date.parse("2026-09-24T10:00:00.000Z");
  fs.writeFileSync(file, headerLine() + userLine("u1", "go") + assistantLine("c1", [toolCall("call-1")], start));
  const reader = new SessionReader();
  const running = await reader.readPage("Maria", file, { limit: 50 });
  assert.equal(toolCallOf(running.items, "c1:0")?.result, null);
  assert.equal(toolCallOf(running.items, "c1:0")?.durationMs, null);

  fs.appendFileSync(file, customLine("x1") + toolResultLine("r1", "call-1", "boom", start + 1234, true));
  const done = await reader.readPage("Maria", file, { after: running.newestCursor ?? undefined, limit: 50 });
  assert.deepEqual(
    done.items.map((item) => item.id),
    ["c1:0"],
  );
  assert.deepEqual([toolCallOf(done.items, "c1:0")?.result, toolCallOf(done.items, "c1:0")?.isError], ["boom", true]);
  assert.equal(toolCallOf(done.items, "c1:0")?.durationMs, 1234);

  fs.appendFileSync(file, errorLine("e1", "529 overloaded"));
  const failed = await reader.readPage("Maria", file, { after: done.newestCursor ?? undefined, limit: 50 });
  assert.deepEqual(failed.items, [
    { kind: "system", id: "e1:0", timestamp: failed.items[0].timestamp, event: "error", text: "529 overloaded" },
  ]);
  fs.appendFileSync(file, contextEditLine("ce1", "e1"));
  const retried = await reader.readPage("Maria", file, { after: failed.newestCursor ?? undefined, limit: 50 });
  assert.deepEqual(
    retried.items.map((item) => (item.kind === "system" ? `${item.id} ${item.event}` : item.id)),
    ["e1:0 retry"],
  );

  // A new prompt closes the turn: nothing older is repeated.
  fs.appendFileSync(file, userLine("u2", "next"));
  const next = await reader.readPage("Maria", file, { after: retried.newestCursor ?? undefined, limit: 50 });
  assert.deepEqual(
    next.items.map((item) => item.id),
    ["u2:0"],
  );
});

test("a partial trailing line is ignored until it is complete", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  const partial = userLine("u2", "second");
  fs.writeFileSync(file, headerLine() + userLine("u1", "first") + partial.slice(0, 20));
  const reader = new SessionReader();
  const page = await reader.readPage("Maria", file, { limit: 50 });
  assert.deepEqual(
    page.items.map((item) => item.id),
    ["u1:0"],
  );
  const before = await reader.newestCursor(file);
  fs.appendFileSync(file, partial.slice(20, -1));
  assert.equal(await reader.newestCursor(file), before);
  fs.appendFileSync(file, "\n");
  const grown = await reader.readPage("Maria", file, { after: page.newestCursor ?? undefined, limit: 50 });
  assert.deepEqual(
    grown.items.map((item) => item.id),
    ["u2:0"],
  );
});

test("a file holding only a partial line, rewritten shorter or replaced, reads correctly", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  fs.writeFileSync(file, headerLine().slice(0, 30));
  const reader = new SessionReader();
  assert.deepEqual(await reader.readPage("Maria", file, { limit: 50 }), {
    agent: "Maria",
    items: [],
    olderCursor: null,
    newestCursor: null,
  });
  fs.writeFileSync(file, headerLine());
  writeTurns(file, 1, 20);
  await readAllPages(reader, file, 7);
  fs.writeFileSync(file, headerLine() + userLine("u9", "fresh start"));
  const page = await reader.readPage("Maria", file, { limit: 50 });
  assert.deepEqual(
    page.items.map((item) => item.id),
    ["u9:0"],
  );
  assert.equal(page.olderCursor, null);

  // Replaced by rename (new inode) with a longer file: the old index must not be reused.
  const replacement = `${file}.new`;
  writeTurns(replacement, 0, 4);
  fs.renameSync(replacement, file);
  assert.deepEqual(
    (await readAllPages(reader, file, 5)).map((item) => item.id),
    turnItemIds(4),
  );
});

test("bad cursors are rejected with the offending field", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  writeTurns(file, 0, 3);
  const reader = new SessionReader();
  const page = await reader.readPage("Maria", file, { limit: 2 });
  const cases: { query: { before?: string; after?: string }; field: string }[] = [
    { query: { before: "abc" }, field: "before" },
    { query: { before: "-1" }, field: "before" },
    { query: { after: "5" }, field: "after" },
    { query: { after: "99999999" }, field: "after" },
    { query: { before: page.olderCursor ?? "", after: page.newestCursor ?? "" }, field: "after" },
  ];
  for (const { query, field } of cases) {
    await assert.rejects(reader.readPage("Maria", file, { ...query, limit: 10 }), (error: unknown) => {
      assert.ok(error instanceof SessionCursorError);
      assert.equal(error.field, field);
      return true;
    });
  }
  // A cursor stays valid for a fresh reader (e.g. after a server restart).
  const restarted = await new SessionReader().readPage("Maria", file, { before: page.olderCursor ?? "", limit: 50 });
  assert.equal(restarted.items.length, 9 - page.items.length);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Clock } from "../../src/clock.js";
import { SessionReader, SessionWatcher } from "../../src/server/sessions.js";
import { headerLine, tempDir, userLine } from "../fixtures/sessions/helpers.js";

const WAIT_MS = 5_000;
/** Lets the watcher's first async check record the starting point. */
const SETTLE_MS = 150;

/** A clock whose `every` timers run only on `tick()`, so the poll never fires by itself. */
function manualClock(): Clock & { tick(): void } {
  const timers = new Set<() => void>();
  return {
    now: () => 0,
    after: () => ({ cancel: () => undefined }),
    every(_ms, fn) {
      timers.add(fn);
      return { cancel: () => timers.delete(fn) };
    },
    tick: () => timers.forEach((fn) => fn()),
  };
}

/** Collects notifications; `next()` resolves with the next one or rejects after WAIT_MS. */
function notifications() {
  const seen: string[] = [];
  let waiter: ((cursor: string) => void) | null = null;
  return {
    seen,
    onAppended(cursor: string) {
      seen.push(cursor);
      waiter?.(cursor);
      waiter = null;
    },
    next(): Promise<string> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no session.appended")), WAIT_MS);
        waiter = (cursor) => {
          clearTimeout(timer);
          resolve(cursor);
        };
      });
    },
  };
}

test("fires with the newest cursor when complete entries are appended, not for partial lines", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  fs.writeFileSync(file, headerLine() + userLine("u1", "one"));
  const reader = new SessionReader();
  const events = notifications();
  const unwatch = new SessionWatcher({ reader }).watch("Maria", file, events.onAppended);
  t.after(unwatch);
  await delay(SETTLE_MS);
  assert.deepEqual(events.seen, []);

  const line = userLine("u2", "two");
  fs.appendFileSync(file, line.slice(0, 10));
  await delay(SETTLE_MS);
  assert.deepEqual(events.seen, []);

  const next = events.next();
  fs.appendFileSync(file, line.slice(10));
  const cursor = await next;
  assert.equal(cursor, await reader.newestCursor(file));
  const page = await reader.readPage("Maria", file, { limit: 50 });
  assert.equal(page.newestCursor, cursor);
});

test("fs.watch alone reports a file created after watching started", async (t) => {
  const file = path.join(tempDir(t), "session.jsonl");
  const reader = new SessionReader();
  const events = notifications();
  // The manual clock is never ticked: only the directory watcher can notice the new file.
  const unwatch = new SessionWatcher({ reader, clock: manualClock() }).watch("Maria", file, events.onAppended);
  t.after(unwatch);
  await delay(SETTLE_MS);
  const next = events.next();
  fs.writeFileSync(file, headerLine() + userLine("u1", "one"));
  assert.equal(await next, await reader.newestCursor(file));
});

test("polling finds a file whose directory did not exist yet, and stops after unwatch", async (t) => {
  const file = path.join(tempDir(t), "Maria", "session.jsonl");
  const clock = manualClock();
  const reader = new SessionReader();
  const events = notifications();
  const unwatch = new SessionWatcher({ reader, clock }).watch("Maria", file, events.onAppended);
  await delay(SETTLE_MS);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, headerLine() + userLine("u1", "one"));
  const next = events.next();
  clock.tick();
  assert.equal(await next, await reader.newestCursor(file));

  unwatch();
  fs.appendFileSync(file, userLine("u2", "two"));
  clock.tick();
  await delay(SETTLE_MS);
  assert.equal(events.seen.length, 1);
});

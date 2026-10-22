import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { WATCHER_ACTIVITY_MAX, WATCHER_OVERVIEW_BYTES } from "../../src/constants.js";
import { readRecentActivity } from "../../src/server/session-recent.js";
import { assistantLine, headerLine } from "../fixtures/sessions/helpers.js";

mkdirSync("tmp", { recursive: true });
const dir = mkdtempSync(path.resolve("tmp/recent-sessions-"));
after(() => rmSync(dir, { recursive: true, force: true }));
function fixture(name: string, text: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

it("bounds invisible-entry scanning instead of searching backwards for visible activity", async () => {
  const file = fixture(
    "invisible.jsonl",
    assistantLine("old", [{ type: "text", text: "Old visible text" }]) + headerLine().repeat(10_000),
  );
  const recent = await readRecentActivity(file);
  assert.deepEqual(recent.items, []);
  assert.equal(recent.scannedEntries, WATCHER_ACTIVITY_MAX);
  assert.ok(recent.scannedBytes <= WATCHER_OVERVIEW_BYTES);
  assert.equal(recent.limited, true);
});

it("bounds huge incomplete and complete records without parsing partial UTF-8", async () => {
  for (const end of ["", "\n"]) {
    const file = fixture(`large-${end.length}.jsonl`, "界".repeat(WATCHER_OVERVIEW_BYTES) + end);
    const recent = await readRecentActivity(file);
    assert.deepEqual(recent.items, []);
    assert.equal(recent.scannedBytes, WATCHER_OVERVIEW_BYTES);
    assert.equal(recent.limited, true);
  }
});

it("retains recent Unicode text after a clipped record and reports missing sessions honestly", async () => {
  const file = fixture(
    "unicode.jsonl",
    "界".repeat(WATCHER_OVERVIEW_BYTES) + "\n" + assistantLine("recent", [{ type: "text", text: "你好 café" }]),
  );
  const recent = await readRecentActivity(file);
  assert.equal(recent.items[0]?.kind, "assistant_text");
  assert.ok(recent.items.some((item) => item.kind === "assistant_text" && item.text === "你好 café"));
  assert.equal(recent.limited, true);
  assert.deepEqual(await readRecentActivity(path.join(dir, "missing")), {
    items: [],
    scannedBytes: 0,
    scannedEntries: 0,
    limited: false,
  });
});

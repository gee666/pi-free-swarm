import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";

test("fake Pi log reads only complete JSONL records while the writer is active", (t) => {
  const fake = createFakePiRun({});
  t.after(() => fake.cleanup());
  writeFileSync(fake.logFile, '{"fake":"spawn"}\n{"type":"pro');
  assert.deepEqual(fake.log(), [{ fake: "spawn" }]);
  appendFileSync(fake.logFile, 'mpt"}\n');
  assert.deepEqual(fake.log(), [{ fake: "spawn" }, { type: "prompt" }]);
  appendFileSync(fake.logFile, "invalid\n");
  assert.throws(() => fake.log(), SyntaxError);
});

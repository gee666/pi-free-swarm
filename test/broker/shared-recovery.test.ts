import assert from "node:assert/strict";
import { test } from "node:test";
import { SharedRecovery } from "../../src/broker/shared-recovery.js";

test("one real recovery attempt per identified group while unrelated workers proceed", () => {
  const recovery = new SharedRecovery();
  const attempts: string[] = [];
  const attempt = (key: string, name: string) => recovery.recover(key, name, () => attempts.push(name));
  attempt("model-a:resource", "a");
  attempt("model-a:resource", "b");
  attempt("model-b:resource", "c");
  assert.deepEqual(attempts, ["a", "c"]);
  attempt("model-a:resource", "a");
  assert.deepEqual(attempts, ["a", "c", "a"]);
  recovery.ready("healthy-unrelated");
  assert.deepEqual(attempts, ["a", "c", "a"]);
  recovery.ready("a");
  assert.deepEqual(attempts, ["a", "c", "a", "b"]);
});

test("bounded exhaustion reports waiting workers without multiplying failed probes", () => {
  const recovery = new SharedRecovery();
  const attempts: string[] = [];
  recovery.recover("group", "a", () => attempts.push("a"));
  recovery.recover("group", "b", () => attempts.push("b"));
  recovery.recover("group", "b", () => attempts.push("duplicate-b"));
  assert.deepEqual(recovery.failed("other"), []);
  assert.deepEqual(recovery.failed("a"), ["b"]);
  recovery.ready("a");
  assert.deepEqual(attempts, ["a"]);
});

test("cancellation clears all waiting shared recoveries", () => {
  const recovery = new SharedRecovery();
  const attempts: string[] = [];
  recovery.recover("group", "a", () => attempts.push("a"));
  recovery.recover("group", "b", () => attempts.push("b"));
  recovery.close();
  recovery.ready("a");
  assert.deepEqual(attempts, ["a"]);
});

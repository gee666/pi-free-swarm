import assert from "node:assert/strict";
import { test } from "node:test";
import { SharedRecovery } from "../../src/broker/shared-recovery.js";
import { StartupAdmission } from "../../src/broker/startup-admission.js";

function candidate(name: string) {
  return { name, launchKey: "same-config", launchFirst: async () => undefined };
}

test("removing an admission leader promotes one current candidate, not removed waiters", () => {
  const launched: string[] = [];
  const admission = new StartupAdmission(
    (worker) => {
      launched.push(worker.name);
    },
    (error) => {
      throw error;
    },
  );
  const first = candidate("First"),
    removed = candidate("Removed"),
    next = candidate("Next"),
    last = candidate("Last");
  for (const worker of [first, removed, next, last]) admission.admit(worker);
  admission.remove(removed);
  admission.remove(first);
  assert.deepEqual(launched, ["First", "Next"]);
  admission.ready(next);
  assert.deepEqual(launched, ["First", "Next", "Last"]);
});

test("removing a shared-recovery leader promotes one bounded actual attempt", () => {
  const recovery = new SharedRecovery();
  const attempted: string[] = [];
  for (const name of ["First", "Removed", "Next", "Last"])
    recovery.recover("config:resource", name, () => {
      attempted.push(name);
    });
  recovery.remove("Removed");
  recovery.remove("First");
  assert.deepEqual(attempted, ["First", "Next"]);
  recovery.ready("Next");
  assert.deepEqual(attempted, ["First", "Next", "Last"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { RunResources } from "../../src/broker/run-resources.js";
import { RunLifecycle } from "../../src/broker/run-lifecycle.js";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Not initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("run cleanup quiesces before joining children and releasing ownership", async () => {
  const scope = new RunResources();
  const joined = deferred<void>();
  const trace: string[] = [];
  scope.add("quiesce", () => {
    trace.push("timers");
  });
  scope.add("join", async () => {
    trace.push("children");
    await joined.promise;
  });
  scope.add("release", () => {
    trace.push("lock");
  });
  const closing = scope.close();
  assert.equal(scope.close(), closing);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(trace, ["timers"]);
  joined.resolve();
  await closing;
  assert.deepEqual(trace, ["timers", "children", "lock"]);
});

test("shutdown joins resources acquired after closing began", async () => {
  const scope = new RunResources();
  const acquired = deferred<string>();
  const disposed = deferred<void>();
  const trace: string[] = [];
  const acquisition = scope.acquire(acquired.promise, "join", async (value) => {
    trace.push(value);
    await disposed.promise;
  });
  let closed = false;
  const closing = scope.close().then(() => {
    closed = true;
  });
  acquired.resolve("late child");
  await acquisition;
  await Promise.resolve();
  assert.deepEqual(trace, ["late child"]);
  assert.equal(closed, false);
  disposed.resolve();
  await closing;
  assert.equal(closed, true);
});

test("cleanup failures remain observable without skipping other resources", async () => {
  const scope = new RunResources();
  let released = false;
  scope.add("quiesce", () => {
    throw new Error("cancel failed");
  });
  scope.add("release", () => {
    released = true;
  });
  await assert.rejects(scope.close(), AggregateError);
  assert.equal(released, true);
});

test("joined retired resources release their cleanup references before whole-run shutdown", async () => {
  const scope = new RunResources();
  const stopped: number[] = [];
  for (let identity = 0; identity < 20; identity++) {
    const stop = () => {
      stopped.push(identity);
    };
    const release = scope.add("join", stop);
    if (identity < 19) {
      stop();
      release();
    }
  }
  await scope.close();
  assert.deepEqual(
    stopped,
    Array.from({ length: 20 }, (_, identity) => identity),
  );
});

test("run lifecycle closes admission monotonically but draining is not shutdown", () => {
  const run = new RunLifecycle();
  assert.equal(run.admitsWork, false);
  run.activate();
  assert.equal(run.admitsWork, true);
  assert.equal(run.drain(), true);
  assert.equal(run.admitsWork, false);
  assert.equal(run.ending, false);
  assert.equal(run.end(), true);
  assert.equal(run.end(), false);
  run.close();
  assert.equal(run.phase, "closed");
  assert.throws(() => run.activate(), /closed/);
});

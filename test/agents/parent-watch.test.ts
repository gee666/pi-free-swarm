import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startParentWatch } from "../../src/agents/parent-watch.js";
import { PARENT_WATCH_INTERVAL_MS, SIGKILL_TIMEOUT_MS } from "../../src/constants.js";
import { FakeClock } from "./fake-clock.js";

test("the watch aborts and shuts down once the runner pid is gone, and only once", () => {
  const clock = new FakeClock();
  let runnerAlive = true;
  const calls: string[] = [];
  startParentWatch({
    runnerPid: 4242,
    clock,
    alive: (pid) => pid === 4242 && runnerAlive,
    abort: () => calls.push("abort"),
    shutdown: () => calls.push("shutdown"),
  });
  clock.advance(PARENT_WATCH_INTERVAL_MS * 3);
  assert.deepEqual(calls, []);
  runnerAlive = false;
  clock.advance(PARENT_WATCH_INTERVAL_MS);
  assert.deepEqual(calls, ["abort", "shutdown"]);
  // Advancing to the backstop would SIGKILL this test process, so stop just before it.
  clock.advance(SIGKILL_TIMEOUT_MS - 1);
  assert.deepEqual(calls, ["abort", "shutdown"]);
  assert.equal(clock.nextDelay(), 1, "only the SIGKILL backstop is left");
});

test("an agent whose runner died kills its own process group when shutdown hangs", async () => {
  const runner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore" });
  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", fileURLToPath(new URL("./parent-watch-child.ts", import.meta.url)), String(runner.pid)],
    { detached: true, stdio: ["ignore", "pipe", "inherit"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const [code, signal] = await once(child, "exit");
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
  assert.equal(output, "watching\nabort\nshutdown\n");
});

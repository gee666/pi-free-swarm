import assert from "node:assert/strict";
import { test } from "node:test";
import { createMainRuntime } from "../../src/main-runtime.js";
import { createMainToolHandlers } from "../../src/tools/main-tools.js";
import { startSwarm, resumeSwarm } from "../../src/broker/swarm-run.js";
import { readRunProgress } from "../../src/broker/run-progress.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

const ctx = { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true };

function runtimeFor(cwd: string) {
  return createMainRuntime({
    cwd,
    extensionPath: "index.ts",
    createHost: () => ({
      start() {},
      ensure: async () => "http://localhost:3010",
      boardUrl: () => "http://localhost:3010",
      stop: async () => undefined,
      releaseSync() {},
    }),
  });
}

test("restart tool uses the newest swarm by default, forwards explicit ids and waits for the runner", async (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const first = seedSwarm(temp.db);
  const second = seedSwarm(temp.db);
  const runtime = runtimeFor(temp.cwd);
  t.after(() => runtime.closeDb());
  const seen: number[] = [];
  let updates = 0;
  const abort = new AbortController();
  const tools = createMainToolHandlers(runtime, {
    startSwarm,
    resumeSwarm,
    async restartSwarm(env, input, options) {
      seen.push(input.swarmId);
      assert.equal(options.signal, abort.signal);
      assert.equal(env.launch.projectTrusted, true);
      options.onProgress?.(readRunProgress(env.db, input.swarmId, Date.now(), null));
      const swarm = getSwarm(env.db, input.swarmId, Date.now());
      assert.ok(swarm);
      return { swarm, run: swarm.runCount, end: "stopped" };
    },
  });
  for (const params of [{}, { swarm: first.id }]) {
    const result = await tools.restart(params, abort.signal, () => updates++, ctx);
    assert.equal(result.details.status, "stopped");
  }
  assert.deepEqual(seen, [second.id, first.id]);
  assert.equal(updates, 2);
});

test("restart tool rejects without creating a database when there are no swarms", async (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const runtime = runtimeFor(temp.cwd);
  t.after(() => runtime.closeDb());
  await assert.rejects(createMainToolHandlers(runtime).restart({}, undefined, undefined, ctx), /no swarms yet/);
});

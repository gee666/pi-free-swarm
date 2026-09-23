// Esc on the swarm tool: the real runner with fake pi agents, aborted mid-run through the tool signal.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import type { RunProgress } from "../../src/broker/run-progress.js";
import { createMainRuntime, type BoardHost } from "../../src/main-runtime.js";
import { listParticipants } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers } from "../../src/tools/main-tools.js";
import { createFakePiRun, SCENARIOS, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";

useFakePi();
const fake = createFakePiRun(SCENARIOS.settle);
const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-abort-"));
after(() => {
  fake.cleanup();
  rmSync(cwd, { recursive: true, force: true });
});

const host: BoardHost = {
  start: () => undefined,
  ensure: async () => null,
  boardUrl: () => null,
  stop: async () => undefined,
  releaseSync: () => undefined,
};

it("aborting the tool signal stops every agent and returns the stopped result", async () => {
  mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".pi/swarm/settings.json"),
    JSON.stringify({ minAgents: 1, staggerSeconds: 0, env: fake.env }),
  );
  const runtime = createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host });
  const tools = createMainToolHandlers(runtime);
  const abort = new AbortController();
  let latest: RunProgress | null = null;
  const pending = tools.swarm(
    { swarm_name: "toy", task_prompt: "Create hello.txt", agent_amount: 2 },
    abort.signal,
    (partial) => (latest = partial.details),
    { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => false },
  );
  await waitFor(() => latest !== null && latest.agents.idle === 2, "both agents idle", 10_000);
  abort.abort();
  const result = await pending;

  assert.equal(result.details.status, "stopped");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /^Swarm "toy" \(#1\) was stopped/);
  const db = runtime.getDb(false);
  assert.ok(db);
  const statuses = listParticipants(db, 1).flatMap((p) => (p.kind === "agent" ? [p.status] : []));
  assert.deepEqual(statuses, ["stopped", "stopped"]);
  runtime.closeDb();
});

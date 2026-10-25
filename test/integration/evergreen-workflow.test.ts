import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { SwarmDetailResponse } from "../../src/api-types.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { startSwarm, resumeSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createMainRuntime } from "../../src/main-runtime.js";
import { ServerHost } from "../../src/server/host.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers } from "../../src/tools/main-tools.js";
import { createFakePiRun, SCENARIOS, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { getJson, postJson } from "../server/helpers.js";
import { FAST } from "./run-fixture.js";

useFakePi();

it("Main and the board share peer quorum, dissent and saved history", { timeout: 60_000 }, async () => {
  mkdirSync("tmp", { recursive: true });
  const cwd = mkdtempSync(path.resolve("tmp/evergreen-workflow-"));
  const fake = createFakePiRun(SCENARIOS.settle);
  mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".pi/swarm/settings.json"),
    JSON.stringify({ minAgents: 1, staggerSeconds: 0, idleReminderDelay: 60_000, env: fake.env }),
  );
  const runtime = createMainRuntime({
    cwd,
    extensionPath: path.resolve("index.ts"),
    createHost: (options) =>
      new ServerHost({
        ...options,
        uiDir: path.resolve("ui_dist"),
        ports: () => ({ candidates: [0], explicit: true }),
      }),
  });
  const tools = createMainToolHandlers(runtime, {
    startSwarm: (env, input, options) => startSwarm({ ...env, timings: FAST }, input, options),
    resumeSwarm: (env, input, options) => resumeSwarm({ ...env, timings: FAST }, input, options),
  });
  const model: Model<"anthropic-messages"> = {
    id: "test",
    name: "Fixture",
    provider: "fixture",
    api: "anthropic-messages",
    baseUrl: "https://fixture.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    contextWindow: 1000,
    maxTokens: 100,
  };
  const ctx = { model, thinkingLevel: "off" as const, isProjectTrusted: () => false };
  let updates = 0;
  try {
    const pending = tools.swarm(
      {
        swarm_name: "evergreen",
        task_prompt: "Implement the documented output in this shared working tree.",
        acceptance_criteria: ["The output matches the requirements file."],
        agent_amount: 4,
      },
      undefined,
      () => updates++,
      ctx,
    );
    await waitFor(() => updates > 0, "Main progress");
    const db = runtime.getDb(false);
    assert.ok(db);
    const base = runtime.host.boardUrl();
    assert.ok(base);
    const detail = await getJson<SwarmDetailResponse>(`${base}/api/swarms/1`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.acceptance.threshold, 3);
    assert.equal(detail.body.acceptance.totalAgents, 4, "Watcher is not a voter");
    const workers = listAgentSessions(db, 1).filter((agent) => agent.name !== "Watcher");
    assert.equal(workers.length, 4);
    await waitFor(
      () =>
        db.sql
          .prepare(
            "SELECT count(*) AS n FROM participants WHERE swarm_id = 1 AND kind = 'agent' AND name != 'Watcher' AND status = 'idle'",
          )
          .get()?.n === 4,
      "all peers idle",
      45_000,
    );
    const post = await postJson(`${base}/api/swarms/1/posts`, { title: "Review evidence", text: "See output.txt" });
    assert.equal(post.status, 201);
    const verdicts = ["accepted", "accepted", "blocked", "incomplete"] as const;
    for (const [index, worker] of workers.entries()) {
      mutateAcceptance(
        db,
        1,
        worker.name,
        { action: "vote", verdict: verdicts[index], reason: `Evidence ${index}` },
        Date.now(),
      );
    }
    const before = updates;
    await waitFor(() => updates > before + 1, "progress after split votes");
    const split = await getJson<SwarmDetailResponse>(`${base}/api/swarms/1`);
    assert.equal(split.body.swarm.status, "running", "idle peers and mixed terminal votes are not completion");
    mutateAcceptance(
      db,
      1,
      workers[3].name,
      { action: "vote", verdict: "accepted", reason: "Output rechecked" },
      Date.now(),
    );
    const result = await pending;
    assert.equal(result.details.status, "finished");
    const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    assert.match(text, /Task verdict: accepted/);
    assert.match(text, /3 accepted, 0 incomplete, 1 blocked/);
    assert.match(text, /blocked\. Reason: Evidence 2/);
    assert.match(text, /not independent verification/);
    assert.match(text, /review the actual work/);
    assert.ok(text.includes(`${base}/s/1`));
    assert.ok(text.includes("The output matches the requirements file."));
    const final = await getJson<SwarmDetailResponse>(`${base}/api/swarms/1`);
    assert.equal(final.body.acceptance.verdict, "accepted");
    assert.equal(final.body.acceptance.votes.length, 4);
    const wall = await fetch(`${base}/api/swarms/1/posts`);
    assert.match(await wall.text(), /See output.txt/);
  } finally {
    await stopAllRuns();
    await runtime.host.stop();
    runtime.closeDb();
    fake.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

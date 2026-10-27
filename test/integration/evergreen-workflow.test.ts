import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { SwarmDetailResponse } from "../../src/api-types.js";
import { startSwarm, resumeSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createMainRuntime } from "../../src/main-runtime.js";
import { ServerHost } from "../../src/server/host.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers } from "../../src/tools/main-tools.js";
import { createFakePiRun, SCENARIOS, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { getJson, postJson } from "../server/helpers.js";
import { FAST } from "./run-fixture.js";
import { finishWork } from "../helpers/finish-work.js";
import { readProject } from "../../src/broker/project.js";
import { evaluateCompletion } from "../../src/broker/completion.js";

useFakePi();

it(
  "Main blocks until completion and resume attaches without restarting active workers",
  { timeout: 60_000 },
  async () => {
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
      let ended = false;
      void pending.then(() => {
        ended = true;
      });
      assert.equal(ended, false);
      const before = fake.log().filter((entry) => entry.fake === "spawn").length;
      const attachedRun = tools.resume(
        { swarm_id: 1, message: "Add regression checks for the output." },
        undefined,
        undefined,
        ctx,
      );
      await waitFor(
        () =>
          db.sql
            .prepare("SELECT 1 FROM tasks WHERE swarm_id = 1 AND title = 'Derive criteria from the update for run 1'")
            .get() !== undefined,
        "update task created",
      );
      assert.equal(ended, false);
      assert.equal(evaluateCompletion(db, 1).done, false);
      finishWork(db, 1);
      const [result, attached] = await Promise.all([pending, attachedRun]);
      for (const output of [result, attached]) {
        const text = output.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        assert.match(text, /Outcome: completed/);
        assert.ok(text.includes(`${base}/s/1`));
      }
      assert.equal(fake.log().filter((entry) => entry.fake === "spawn").length, before);
      assert.equal(readProject(db, 1).outcome, "completed");
      const final = await getJson<SwarmDetailResponse>(`${base}/api/swarms/1`);
      assert.equal(final.body.swarm.status, "finished");
      const wall = await fetch(`${base}/api/swarms/1/posts`);
      assert.match(await wall.text(), /See output.txt/);
    } finally {
      await stopAllRuns();
      await runtime.host.stop();
      runtime.closeDb();
      fake.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

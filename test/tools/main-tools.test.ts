import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { Value } from "typebox/value";
import { MAIN_TOOL } from "../../src/constants.js";
import { readRunProgress, type RunProgress } from "../../src/broker/run-progress.js";
import { resumeSwarm, type RunEnvironment, type RunOptions } from "../../src/broker/swarm-run.js";
import { createSwarm, endRun } from "../../src/broker/swarms.js";
import { createMainRuntime, type BoardHost } from "../../src/main-runtime.js";
import { pickAgentNames } from "../../src/names.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers, registerMainTools, type SwarmRunner } from "../../src/tools/main-tools.js";
import type { LaunchSource } from "../../src/tools/run-environment.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";

const BOARD = "http://127.0.0.1:3999";
const EXTENSION = "/abs/pi-free-swarm/index.ts";
const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(settings?: string): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-tools-"));
  dirs.push(cwd);
  if (settings !== undefined) {
    mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
    writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), settings);
  }
  return cwd;
}

function fakeHost(): BoardHost & { starts: number } {
  return {
    starts: 0,
    start() {
      this.starts++;
    },
    ensure: async () => BOARD,
    boardUrl: () => BOARD,
    stop: async () => undefined,
    releaseSync: () => undefined,
  };
}

function runtimeFor(cwd: string) {
  const host = fakeHost();
  const notes: string[] = [];
  const runtime = createMainRuntime({ cwd, extensionPath: EXTENSION, createHost: () => host });
  runtime.attachUi({ notify: (message) => void notes.push(message) });
  return { runtime, host, notes };
}

function texts(content: { type: string; text?: string }[]): string[] {
  return content.flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []));
}

const ctx: LaunchSource = {
  model: undefined,
  thinkingLevel: undefined,
  isProjectTrusted: () => true,
};

/** Creates the swarm like the real runner, reports once, then waits for the abort (Esc) and stops. */
function stoppingRunner(seen: { env?: RunEnvironment; options?: RunOptions }): SwarmRunner {
  return {
    async startSwarm(env, input, options) {
      seen.env = env;
      seen.options = options;
      const swarm = createSwarm(env.db, {
        name: input.name,
        taskPrompt: input.taskPrompt,
        agentNames: pickAgentNames(input.agentAmount),
        runnerPid: env.runnerPid,
        now: Date.now(),
      });
      options.onProgress?.(readRunProgress(env.db, swarm.id, Date.now(), env.boardUrl()));
      if (!options.signal?.aborted) {
        await new Promise((resolve) => options.signal?.addEventListener("abort", resolve, { once: true }));
      }
      endRun(env.db, swarm.id, env.runnerPid, "stopped", Date.now());
      const ended = getSwarm(env.db, swarm.id, Date.now());
      assert.ok(ended);
      return { swarm: ended, run: 1, end: "stopped" };
    },
    resumeSwarm,
  };
}

describe("registerMainTools", () => {
  it("registers swarm and resume_swarm with the live agent range in the description", () => {
    const pi = new FakeExtensionApi();
    const { runtime } = runtimeFor(project('{"minAgents": 2, "maxAgents": 8}'));
    registerMainTools(pi, runtime);
    assert.deepEqual(pi.toolNames(), [MAIN_TOOL.swarm, MAIN_TOOL.resumeSwarm]);
    const swarm = pi.tool(MAIN_TOOL.swarm);
    assert.match(swarm.description, /agent_amount: 2–8, default 5/);
    assert.match(swarm.description, /concise/);
    assert.match(swarm.description, /requirements/);
    for (const tool of pi.tools) assert.ok(tool.promptSnippet);
  });

  it("names an invalid settings file in the description instead of failing to load", () => {
    const pi = new FakeExtensionApi();
    registerMainTools(pi, runtimeFor(project("{nope")).runtime);
    assert.match(pi.tool(MAIN_TOOL.swarm).description, /settings\.json: invalid JSON/);
  });

  it("validates parameters with the registered schemas", () => {
    const pi = new FakeExtensionApi();
    registerMainTools(pi, runtimeFor(project()).runtime);
    const swarm = pi.tool(MAIN_TOOL.swarm).parameters;
    assert.ok(Value.Check(swarm, { swarm_name: "x", task_prompt: "Read docs/req.md" }));
    assert.ok(Value.Check(swarm, { swarm_name: "x", task_prompt: "y", agent_amount: 3 }));
    assert.ok(!Value.Check(swarm, { swarm_name: "x", task_prompt: "y", agent_amount: 2.5 }));
    assert.ok(!Value.Check(swarm, { swarm_name: "x" }));
    const resume = pi.tool(MAIN_TOOL.resumeSwarm).parameters;
    assert.ok(Value.Check(resume, { swarm_id: 3, message: "fix the tests" }));
    assert.ok(!Value.Check(resume, { swarm_id: "3", message: "fix" }));
  });
});

describe("swarm tool", () => {
  it("rejects an agent_amount outside the settings range without creating anything", async () => {
    const cwd = project('{"minAgents": 2, "maxAgents": 8}');
    const { runtime } = runtimeFor(cwd);
    const tools = createMainToolHandlers(runtime);
    await assert.rejects(
      tools.swarm({ swarm_name: "x", task_prompt: "y", agent_amount: 12 }, undefined, undefined, ctx),
      { message: "agent_amount must be between 2 and 8 (got 12)." },
    );
    assert.equal(runtime.getDb(false), null);
  });

  it("fails with the settings error and shows settings warnings", async () => {
    const tools = createMainToolHandlers(runtimeFor(project('{"maxAgents": 1, "minAgents": 3}')).runtime);
    await assert.rejects(tools.swarm({ swarm_name: "x", task_prompt: "y" }, undefined, undefined, ctx), {
      message: "settings.json: maxAgents (1) must be >= minAgents (3)",
    });
    const warned = runtimeFor(project('{"colour": "blue", "maxAgents": 1}'));
    await assert.rejects(
      createMainToolHandlers(warned.runtime).swarm(
        { swarm_name: "x", task_prompt: "y", agent_amount: 5 },
        undefined,
        undefined,
        ctx,
      ),
      { message: "agent_amount must be between 1 and 1 (got 5)." },
    );
    assert.deepEqual(warned.notes, ['settings.json: unknown key "colour" ignored']);
  });

  it("runs with the captured launch context, streams progress and stops on abort", async () => {
    const cwd = project('{"minAgents": 1}');
    const { runtime, host } = runtimeFor(cwd);
    const seen: { env?: RunEnvironment; options?: RunOptions } = {};
    const tools = createMainToolHandlers(runtime, stoppingRunner(seen));
    const updates: RunProgress[] = [];
    const abort = new AbortController();
    const trusted: LaunchSource = {
      model: undefined,
      thinkingLevel: "high",
      isProjectTrusted: () => true,
    };
    const pending = tools.swarm(
      { swarm_name: "toy", task_prompt: "Read docs/req.md", agent_amount: 2 },
      abort.signal,
      (partial) => updates.push(partial.details),
      trusted,
    );
    while (updates.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    const result = await pending;

    assert.equal(host.starts, 1);
    assert.equal(seen.options?.signal, abort.signal);
    assert.deepEqual(seen.env?.launch, { extensionArgs: [EXTENSION], projectTrusted: true, model: null });
    assert.equal(seen.env?.settings.minAgents, 1);
    assert.equal(updates[0].agents.pending, 2);
    assert.equal(result.details.status, "stopped");
    const [summary, hint] = texts(result.content);
    assert.match(summary, /^Swarm "toy" \(#1\) was stopped/);
    assert.match(summary, /Board: http:\/\/127\.0\.0\.1:3999\/s\/1/);
    assert.match(hint, /suggest adding to \.gitignore:\n\.pi\/swarm\/\*\n!\.pi\/swarm\/settings\.json$/);

    // Only the swarm that created .pi/swarm/ suggests the .gitignore entry.
    const again = new AbortController();
    const second = tools.swarm(
      { swarm_name: "toy2", task_prompt: "t", agent_amount: 1 },
      again.signal,
      () => again.abort(),
      trusted,
    );
    assert.equal(texts((await second).content).length, 1);
  });
});

describe("resume_swarm tool", () => {
  it("rejects when the project has no swarms", async () => {
    const tools = createMainToolHandlers(runtimeFor(project()).runtime);
    await assert.rejects(tools.resume({ swarm_id: 3, message: "more" }, undefined, undefined, ctx), {
      message: "Swarm #3 not found: this project has no swarms yet.",
    });
  });

  it("passes the runner's rejections through: unknown swarm and a swarm running elsewhere", async () => {
    const cwd = project();
    const { runtime } = runtimeFor(cwd);
    const db = runtime.getDb(true);
    assert.ok(db);
    // The parent process is alive, so its run lock is fresh.
    createSwarm(db, { name: "busy", taskPrompt: "t", agentNames: ["Maria"], runnerPid: process.ppid, now: Date.now() });
    const tools = createMainToolHandlers(runtime);
    await assert.rejects(tools.resume({ swarm_id: 9, message: "more" }, undefined, undefined, ctx), {
      message: "Swarm #9 not found.",
    });
    await assert.rejects(tools.resume({ swarm_id: 1, message: "more" }, undefined, undefined, ctx), {
      message: `Swarm #1 is running in another pi process (pid ${process.ppid}).`,
    });
    runtime.closeDb();
  });
});

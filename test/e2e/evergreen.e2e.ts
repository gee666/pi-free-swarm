import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { evaluateCompletion } from "../../src/broker/completion.js";
import { approveScope } from "../../src/broker/project.js";
import { swarmDbPath, openSwarmDb } from "../../src/store/db.js";
import { listAgentSessions, listSwarms } from "../../src/store/swarm-queries.js";
import { listPosts } from "../../src/store/wall-queries.js";

const pi = process.env.EVERGREEN_PI_BIN || "pi";
const model = process.env.EVERGREEN_E2E_MODEL;

async function runPi(cwd: string, prompt: string, session: string): Promise<JsonAgentSessionEvent[]> {
  assert.ok(model, "Set EVERGREEN_E2E_MODEL to an authenticated provider/model[:thinking].");
  const env = { ...process.env };
  // A test launched from a worker must still start as Main, not inherit its identity or fake binary.
  for (const key of Object.keys(env)) if (key.startsWith("PI_SWARM_")) delete env[key];
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      pi,
      [
        "-p",
        "--mode",
        "json",
        "--model",
        model,
        "--session",
        session,
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--approve",
        "-e",
        path.resolve("."),
        "--swarm",
        "--",
        prompt,
      ],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"], signal: AbortSignal.timeout(240_000) },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Pi exited ${code ?? signal}: ${stderr}\n${stdout.slice(-20_000)}\nProject: ${cwd}`));
    });
  });
  return output
    .split("\n")
    .filter(Boolean)
    .map((line): JsonAgentSessionEvent => JSON.parse(line));
}

function successfulTool(events: JsonAgentSessionEvent[], name: string): void {
  assert.ok(
    events.some((event) => event.type === "tool_execution_end" && event.toolName === name && !event.isError),
    `Expected a successful ${name} call, got:\n${JSON.stringify(events).slice(-20_000)}`,
  );
}

it(
  "installed Pi delegates real work, preserves peer evidence and resumes the same worker session",
  { timeout: 510_000, skip: !model },
  async () => {
    mkdirSync(path.resolve("tmp"), { recursive: true });
    const cwd = mkdtempSync(path.resolve("tmp/pi-free-swarm-evergreen-"));
    mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi/swarm/settings.json"),
      JSON.stringify({
        minAgents: 1,
        maxAgents: 2,
        defaultAgents: 2,
        staggerSeconds: 0,
        idleReminderDelay: 60_000,
        budgetTimeSeconds: 180,
      }),
    );
    writeFileSync(
      path.join(cwd, "requirements.txt"),
      [
        "Create result.txt containing exactly evergreen-one followed by a newline.",
        "Use swarm_posts_create to record short evidence pointing to result.txt, then read the file to verify it.",
        "Complete the seeded planning tasks and linked implementation tasks through independent review, then vote on every criterion with swarm_criteria_vote. Have a second worker review and vote independently.",
        "On resume, reopen the affected task, follow Main feedback, verify the changed file, request independent review and re-vote affected criteria.",
      ].join("\n"),
    );
    let passed = false;
    try {
      const first = await runPi(
        cwd,
        [
          "Use the swarm tool now with swarm_name evergreen, agent_amount 2, and task_prompt 'Read requirements.txt and implement it.'",
          "Set acceptance_criteria to ['result.txt matches requirements.txt or explicit resume feedback; worker wall evidence references result.txt.'].",
          "Do not implement the task yourself. After the swarm returns, use read to inspect result.txt and summarize the actual result.",
        ].join(" "),
        path.join(cwd, "main-first.jsonl"),
      );
      successfulTool(first, "swarm");
      successfulTool(first, "read");
      assert.equal(readFileSync(path.join(cwd, "result.txt"), "utf8"), "evergreen-one\n");
      const db = openSwarmDb(swarmDbPath(cwd), { create: false });
      let workerSession: string;
      let originalSession: string;
      let swarmId: number;
      try {
        const [swarm] = listSwarms(db, Date.now());
        assert.ok(swarm);
        swarmId = swarm.id;
        if (evaluateCompletion(db, swarmId).awaitingUser) approveScope(db, { swarmId, actor: "User", now: Date.now() });
        assert.equal(evaluateCompletion(db, swarmId).done, true);
        assert.ok(
          listPosts(db, swarmId, { count: 100, offset: 0 }).posts.some((post) => post.text.includes("result.txt")),
        );
        const workers = listAgentSessions(db, swarmId).filter((agent) => agent.name !== "Watcher");
        assert.equal(workers.length, 2);
        workerSession = workers[0].sessionFile;
        originalSession = readFileSync(workerSession, "utf8");
        assert.match(originalSession, /"toolName":"swarm_criteria_vote"/);
        assert.match(originalSession, /"toolName":"swarm_posts_create"/);
        assert.doesNotMatch(originalSession, /"name":"resume_swarm"/, "workers cannot launch nested swarms");
      } finally {
        db.close();
      }
      const resumed = await runPi(
        cwd,
        [
          `Call resume_swarm for swarm_id ${swarmId} with message: 'Replace result.txt with exactly evergreen-two followed by a newline.`,
          "Read it back, request independent review, and cast fresh criterion votes. This replaces the original expected content.'",
          "Do not change the file yourself. After the tool returns, use read to inspect result.txt and summarize.",
        ].join(" "),
        path.join(cwd, "main-resumed.jsonl"),
      );
      successfulTool(resumed, "resume_swarm");
      successfulTool(resumed, "read");
      assert.equal(readFileSync(path.join(cwd, "result.txt"), "utf8"), "evergreen-two\n");
      const reopened = openSwarmDb(swarmDbPath(cwd), { create: false });
      try {
        assert.equal(listSwarms(reopened, Date.now()).length, 1, "resume must not create a new swarm");
        if (evaluateCompletion(reopened, swarmId).awaitingUser)
          approveScope(reopened, { swarmId, actor: "User", now: Date.now() });
        assert.equal(evaluateCompletion(reopened, swarmId).done, true);
        assert.ok(listAgentSessions(reopened, swarmId).some((agent) => agent.sessionFile === workerSession));
        const continued = readFileSync(workerSession, "utf8");
        assert.ok(continued.startsWith(originalSession), "resume appends to the worker's persisted history");
        assert.ok(continued.length > originalSession.length);
      } finally {
        reopened.close();
      }
      passed = true;
    } finally {
      if (passed) rmSync(cwd, { recursive: true, force: true });
      else console.error(`Evergreen e2e evidence retained at ${cwd}`);
    }
  },
);

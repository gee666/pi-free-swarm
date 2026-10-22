import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { readRunProgress, type RunProgress } from "../../src/broker/run-progress.js";
import type { RunEnvironment, RunOptions, RunOutcome } from "../../src/broker/swarm-run.js";
import { createSwarm, endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { createMainRuntime } from "../../src/main-runtime.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers, type SwarmRunner } from "../../src/tools/main-tools.js";
import { buildRunResultText } from "../../src/tools/result.js";
import { gitignoreHint } from "../../src/tools/run-environment.js";

const BOARD = "http://127.0.0.1:3999";
const CRITERIA = ["All requested behavior works.", "Tests pass."];
const AGENTS = ["Maria", "John", "Liam", "Olivia", "Emma"];
const ctx = { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true };

for (const mode of ["swarm", "resume"] as const) {
  for (const size of ["bytes", "lines"] as const) {
    it(`${mode} bounds vote reasons by ${size} and preserves all reasons and progress`, async () => {
      mkdirSync("tmp", { recursive: true });
      const cwd = mkdtempSync(path.resolve("tmp/pi-main-result-"));
      const runtime = createMainRuntime({
        cwd,
        extensionPath: "/extension/index.ts",
        createHost: () => ({
          start() {},
          ensure: async () => BOARD,
          boardUrl: () => BOARD,
          stop: async () => undefined,
          releaseSync() {},
        }),
      });
      let spill: string | undefined;
      try {
        const end = mode === "swarm" ? "finished" : "stopped";
        const reason =
          size === "lines"
            ? `${"diagnostic line\n".repeat(DEFAULT_MAX_LINES + 1)}reason-tail`
            : `${"😀".repeat(DEFAULT_MAX_BYTES)}reason-tail`;
        const dissent = "I disagree: the rollback path has not been checked.";
        let fullText = "";
        let expectedProgress: RunProgress | undefined;
        const complete = (env: RunEnvironment, swarmId: number, options: RunOptions) => {
          createPost(env.db, swarmId, "Maria", { title: "Wall only", text: "Do not dump this wall body." }, Date.now());
          for (const [index, agent] of AGENTS.entries()) {
            mutateAcceptance(
              env.db,
              swarmId,
              agent,
              {
                action: "vote",
                verdict: agent === "Emma" ? "accepted" : "blocked",
                reason: index === 0 ? reason : agent === "Emma" ? dissent : `${agent} needs an owner decision.`,
              },
              Date.now(),
            );
          }
          options.onProgress?.(readRunProgress(env.db, swarmId, Date.now(), BOARD));
          endRun(env.db, swarmId, env.runnerPid, end, Date.now());
          const swarm = getSwarm(env.db, swarmId, Date.now());
          assert.ok(swarm);
          const outcome: RunOutcome = { swarm, run: 1, end, acceptance: inspectAcceptance(env.db, swarmId) };
          fullText = buildRunResultText(env.db, outcome, BOARD, Date.now());
          expectedProgress = { ...readRunProgress(env.db, swarmId, Date.now(), BOARD), status: end };
          return outcome;
        };
        const runner: SwarmRunner = {
          async startSwarm(env, input, options) {
            assert.deepEqual(input.acceptanceCriteria, CRITERIA);
            const swarm = createSwarm(env.db, {
              name: input.name,
              taskPrompt: input.taskPrompt,
              acceptanceCriteria: input.acceptanceCriteria,
              agentNames: AGENTS,
              runnerPid: env.runnerPid,
              now: Date.now(),
            });
            return complete(env, swarm.id, options);
          },
          async resumeSwarm(env, input, options) {
            return complete(env, input.swarmId, options);
          },
        };
        const tools = createMainToolHandlers(runtime, runner);
        const updates: RunProgress[] = [];
        const onUpdate = (partial: { details: RunProgress }) => updates.push(partial.details);
        let swarmId = 0;
        if (mode === "resume") {
          const db = runtime.getDb(true);
          assert.ok(db);
          swarmId = createSwarm(db, {
            name: "large",
            taskPrompt: "Check the complete task",
            acceptanceCriteria: CRITERIA,
            agentNames: AGENTS,
            runnerPid: process.pid,
            now: Date.now(),
          }).id;
        }
        const result =
          mode === "swarm"
            ? await tools.swarm(
                {
                  swarm_name: "large",
                  task_prompt: "Check the complete task",
                  acceptance_criteria: CRITERIA,
                  agent_amount: AGENTS.length,
                },
                undefined,
                onUpdate,
                ctx,
              )
            : await tools.resume({ swarm_id: swarmId, message: "Recheck" }, undefined, onUpdate, ctx);
        const { fullOutputPath, ...progress } = result.details;
        spill = fullOutputPath;
        assert.ok(spill);
        assert.deepEqual(progress, expectedProgress);
        assert.equal(progress.status, end);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].posts, 1);
        const preview = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        assert.ok(Buffer.byteLength(preview) <= DEFAULT_MAX_BYTES);
        assert.ok(preview.split("\n").length <= DEFAULT_MAX_LINES);
        assert.match(preview, /^Swarm "large"/);
        assert.match(preview, /Goal: Check the complete task/);
        assert.match(preview, /Acceptance criteria:\n1\. All requested behavior works\.\n2\. Tests pass\./);
        if (end === "finished") assert.match(preview, /Task verdict: blocked/);
        else {
          assert.match(preview, /Task verdict: not finalized \(run stopped/);
          assert.match(preview, /Recorded vote verdict: blocked/);
          assert.doesNotMatch(preview, /consensus/);
        }
        assert.match(preview, /Tally: 1 accepted, 0 incomplete, 4 blocked; 5\/5 agents voted\. Threshold: 4\/5/);
        assert.ok(preview.includes(spill));
        const saved = readFileSync(spill, "utf8");
        const hint = mode === "swarm" ? gitignoreHint(cwd) : null;
        assert.equal(saved, hint === null ? fullText : `${fullText}\n${hint}`);
        assert.ok(saved.includes(`Maria (run 1): blocked. Reason: ${reason}`));
        assert.ok(saved.includes(`Emma (run 1): accepted. Reason: ${dissent}`));
        for (const agent of AGENTS.slice(1, 4)) {
          assert.ok(saved.includes(`${agent} (run 1): blocked. Reason: ${agent} needs an owner decision.`));
        }
        assert.match(saved, /resume_swarm\(/);
        assert.doesNotMatch(saved, /Wall digest|Do not dump this wall body/);
        if (size === "bytes") assert.ok(Buffer.byteLength(saved) > DEFAULT_MAX_BYTES);
        else assert.ok(saved.split("\n").length > DEFAULT_MAX_LINES);
      } finally {
        runtime.closeDb();
        if (spill !== undefined) rmSync(path.dirname(spill), { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}

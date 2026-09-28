import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { readRunProgress, type RunProgress } from "../../src/broker/run-progress.js";
import type { RunEnvironment, RunOptions, RunOutcome } from "../../src/broker/swarm-run.js";
import { createSwarm, endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { WALL_DIGEST_MAX_POSTS } from "../../src/constants.js";
import { BODY_SAFETY_MAX, bodyCeiling, TEXT_MAX } from "../../src/limits.js";
import { createMainRuntime } from "../../src/main-runtime.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createMainToolHandlers, type SwarmRunner } from "../../src/tools/main-tools.js";
import { buildRunResultText } from "../../src/tools/result.js";
import { gitignoreHint } from "../../src/tools/run-environment.js";

const BOARD = "http://127.0.0.1:3999";
const ctx = { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true };

for (const mode of ["swarm", "resume"] as const) {
  for (const bodyMaxChars of [TEXT_MAX, BODY_SAFETY_MAX]) {
    it(`${mode} bounds ${WALL_DIGEST_MAX_POSTS} legal ${bodyMaxChars}-character bodies and preserves full evidence and progress`, async () => {
      const cwd = mkdtempSync(path.join(tmpdir(), "pi-main-result-"));
      mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
      if (bodyMaxChars !== TEXT_MAX) {
        writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), JSON.stringify({ bodyMaxChars }));
      }
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
        const hugeEvidence = bodyMaxChars === BODY_SAFETY_MAX;
        const evidence = hugeEvidence
          ? `${"evidence line\n".repeat(DEFAULT_MAX_LINES + 1)}evidence-tail`
          : "all checks recorded";
        const body = "😀".repeat(bodyCeiling(bodyMaxChars));
        let fullText = "";
        let expectedProgress: RunProgress | undefined;
        const complete = (env: RunEnvironment, swarmId: number, options: RunOptions) => {
          for (let i = 0; i < WALL_DIGEST_MAX_POSTS; i++) {
            createPost(env.db, swarmId, "Maria", { title: `Post ${i}`, text: body }, Date.now());
          }
          mutateAcceptance(env.db, swarmId, "Maria", { action: "claim", revision: 0 }, Date.now());
          mutateAcceptance(
            env.db,
            swarmId,
            "Maria",
            {
              action: "update",
              revision: 1,
              verdict: "blocked",
              payload: {
                evidence: [{ reference: "checks.log", result: evidence, command: "npm test", cwd }],
                knownGaps: ["An owner decision is needed"],
                findings: ["Resolve the diagnostic contract"],
              },
            },
            Date.now(),
          );
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
            const swarm = createSwarm(env.db, {
              name: input.name,
              taskPrompt: input.taskPrompt,
              agentNames: ["Maria"],
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
            agentNames: ["Maria"],
            runnerPid: process.pid,
            now: Date.now(),
          }).id;
        }
        const result =
          mode === "swarm"
            ? await tools.swarm(
                { swarm_name: "large", task_prompt: "Check the complete task", agent_amount: 1 },
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
        assert.equal(updates[0].posts, WALL_DIGEST_MAX_POSTS);
        const preview = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        assert.ok(Buffer.byteLength(preview) <= DEFAULT_MAX_BYTES);
        assert.ok(preview.split("\n").length <= DEFAULT_MAX_LINES);
        assert.match(preview, /^Swarm "large"/);
        assert.match(preview, /Task verdict: blocked/);
        assert.match(preview, /Task completion is not accepted/);
        assert.ok(preview.includes(spill));
        if (!hugeEvidence) {
          assert.match(preview, /Evidence: checks.log — all checks recorded/);
          assert.match(preview, /Known gap: An owner decision is needed/);
          assert.match(preview, /Unresolved finding: Resolve the diagnostic contract/);
        }
        const saved = readFileSync(spill, "utf8");
        const hint = mode === "swarm" ? gitignoreHint(cwd) : null;
        assert.equal(saved, hint === null ? fullText : `${fullText}\n${hint}`);
        assert.ok(saved.includes(body));
        assert.ok(saved.includes(`"Post ${WALL_DIGEST_MAX_POSTS - 1}"`));
        assert.ok(saved.includes(`Evidence: checks.log — ${evidence}`));
        assert.match(saved, /resume_swarm\(/);
        assert.ok(Buffer.byteLength(saved) > DEFAULT_MAX_BYTES);
      } finally {
        runtime.closeDb();
        if (spill !== undefined) rmSync(path.dirname(spill), { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}

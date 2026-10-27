import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER, SYSTEM_PROMPT_FILE } from "../../src/constants.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, agentStatus, createRunFixture, newestSwarmId, promptTexts, waitFor } from "./run-fixture.js";

it(
  "supplies only the brief path and discovers the current graph on kickoff, revive and resume",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture({ spawns: [SCENARIOS.crash, SCENARIOS.settle] });
    const acceptanceCriteria = ["The login form works.", "Regression tests pass."];
    const firstAbort = new AbortController();
    const first = startSwarm(
      run.env,
      { name: "launch-criteria", taskPrompt: "Fix login.", acceptanceCriteria, agentAmount: 1 },
      { signal: firstAbort.signal },
    );
    const swarmId = newestSwarmId(run.db);
    const [name] = agentNames(run.db, swarmId);
    try {
      await waitFor(
        () =>
          promptTexts(run.fake).some((text) => text.startsWith(REVIVE_PROMPT_HEADER)) &&
          agentStatus(run.db, swarmId, name) === "idle",
        "revived worker to settle",
        10_000,
      );
      const worker = listAgentSessions(run.db, swarmId).find((agent) => agent.name === name);
      assert.ok(worker);
      const systemPrompt = readFileSync(path.join(path.dirname(worker.sessionFile), SYSTEM_PROMPT_FILE), "utf8");
      assert.match(systemPrompt, /brief\.md/);
      assert.doesNotMatch(systemPrompt, /Fix login\./);
      for (const criterion of acceptanceCriteria) assert.ok(!systemPrompt.includes(criterion));
      const prompts = promptTexts(run.fake);
      const kickoff = prompts.find((text) => text.startsWith("Start: call swarm_project."));
      assert.ok(kickoff);
      assert.ok(!kickoff.includes("Fix login."));
      for (const criterion of acceptanceCriteria) assert.ok(!kickoff.includes(criterion));
      const revived = prompts.find((text) => text.startsWith(REVIVE_PROMPT_HEADER));
      assert.ok(revived);
      assert.match(revived, /swarm_project/);
      assert.match(revived, /do not replay writes/);
      firstAbort.abort();
      assert.equal((await first).end, "stopped");

      const resumeAbort = new AbortController();
      const resumed = resumeSwarm(run.env, { swarmId, message: "Check once more." }, { signal: resumeAbort.signal });
      try {
        await waitFor(
          () => promptTexts(run.fake).some((text) => text.startsWith(RESUME_PROMPT_HEADER)),
          "resume prompt",
        );
        const prompt = promptTexts(run.fake).find((text) => text.startsWith(RESUME_PROMPT_HEADER));
        assert.ok(prompt);
        assert.match(prompt, /swarm_project/);
      } finally {
        resumeAbort.abort();
        await resumed;
      }
    } finally {
      firstAbort.abort();
      await first;
      run.cleanup();
    }
  },
);

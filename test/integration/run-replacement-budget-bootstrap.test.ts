import { finishWork } from "../helpers/finish-work.js";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { raiseSwarmBudget } from "../../src/broker/budget-policy.js";
import { systemNotice } from "../helpers/system-notice.js";
import { requestRetirement } from "../../src/broker/retirement.js";
import { createPost } from "../../src/broker/wall.js";
import { activeWorkerNames } from "../../src/store/active-roster.js";
import { readBudget } from "../../src/store/budget.js";
import { getConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentStatus, createRunFixture, isAlive, recipientStatus, waitFor } from "./run-fixture.js";

test(
  "budget stop during retired-child cleanup retains the unlaunched replacement bootstrap on resume",
  { timeout: 40_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    run.env.settings.budgetTimeSeconds = 1;
    const release = path.join(run.cwd, "replacement-bootstrap-release");
    writeFileSync(
      run.fake.env.FAKE_PI_SCENARIO,
      JSON.stringify({
        agents: { Watcher: {} },
        spawns: [
          { ...SCENARIOS.settle, ignoreSigterm: true },
          { runs: [[{ type: "waitForFile", file: release }, { type: "reply" }], [{ type: "reply" }]] },
        ],
      }),
    );
    const owner = await configurationOwner(run, 1);
    const { swarmId } = owner;
    try {
      const [oldName] = activeWorkerNames(run.db, swarmId);
      await waitFor(() => agentStatus(run.db, swarmId, oldName) === "idle", "old worker first idle");
      const posts = Array.from({ length: 13 }, (_, index) =>
        createPost(
          run.db,
          swarmId,
          "User",
          { title: `Before stop ${index}`, text: `BOOTSTRAP-WALL-${index}` },
          Date.now(),
        ),
      );
      const oldMessage = systemNotice(run.db, {
        swarmId: swarmId,
        to: oldName,
        text: "OLD-ROLE-PENDING-EVIDENCE",
        now: Date.now(),
      });
      const handoff = "DURABLE-UNLAUNCHED-HANDOFF. Inspect the completed evidence and avoid uncertain work replay.";
      requestRetirement(run.db, swarmId, oldName, 1, handoff, Date.now());
      await owner.advance(50);
      await waitFor(
        () => activeWorkerNames(run.db, swarmId)[0] !== oldName,
        "replacement slot committed before cleanup joins",
      );
      const [newName] = activeWorkerNames(run.db, swarmId);
      const oldSpawn = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === oldName);
      assert.ok(oldSpawn && typeof oldSpawn.pid === "number");
      assert.equal(isAlive(oldSpawn.pid), true, "stubborn old child makes the cleanup boundary observable");
      assert.equal(
        run.fake.log().some((entry) => entry.fake === "spawn" && entry.agent === newName),
        false,
      );
      const newMessage = systemNotice(run.db, {
        swarmId: swarmId,
        to: newName,
        text: "NEW-ROLE-PENDING-NOT-FIRST-PROMPT",
        now: Date.now(),
      });
      await owner.advance(950);
      await owner.advance(5000);
      await owner.finished();
      assert.equal(getSwarm(run.db, swarmId, Date.now())?.status, "stopped");
      assert.equal(readBudget(run.db, swarmId, run.env.settings, Date.now()).stopReason, "budget-exhausted");
      assert.equal(isAlive(oldSpawn.pid), false);
      assert.equal(
        run.fake.log().some((entry) => entry.fake === "spawn" && entry.agent === newName),
        false,
        "budget exhaustion prevents late replacement admission",
      );
      assert.equal(recipientStatus(run.db, oldMessage.id, oldName), "pending");
      assert.equal(recipientStatus(run.db, newMessage.id, newName), "pending");
      raiseSwarmBudget(run.db, swarmId, { timeSeconds: 20 }, getConfigurationRevision(run.db, swarmId), Date.now());
      const resumed = await configurationOwner(run, 1, swarmId);
      try {
        await waitFor(
          () => agentStatus(run.db, swarmId, newName) === "working",
          "fresh replacement resumes into its own initial turn",
        );
        const first = run.fake.log().find((entry) => entry.type === "prompt" && entry.agent === newName);
        assert.ok(first && typeof first.message === "string");
        assert.ok(first.message.includes(handoff), "the staged handoff survives owner shutdown before first launch");
        assert.ok(!first.message.includes("OLD-ROLE-PENDING-EVIDENCE"));
        assert.ok(!first.message.includes("NEW-ROLE-PENDING-NOT-FIRST-PROMPT"));
        assert.ok(!first.message.includes("BOOTSTRAP-WALL"));
        const tools = createAgentToolHandlers({ getDb: () => run.db, swarmId, run: 2, agentName: newName });
        const wall = await tools.postsSearch({ limit: 50 });
        for (const post of posts.slice(-10)) assert.ok(wall.includes(post.title));
        assert.ok(!wall.includes(`\"${posts[0].text}\"`));
        writeFileSync(release, "ready");
        await waitFor(() => agentStatus(run.db, swarmId, newName) === "idle", "replacement finishes first fresh turn");
        assert.equal(recipientStatus(run.db, oldMessage.id, oldName), "pending");
        assert.equal(activeWorkerNames(run.db, swarmId).length, 1);
        finishWork(run.db, swarmId);
        await resumed.finished();
      } finally {
        await resumed.close();
      }
    } finally {
      await owner.close();
      run.cleanup();
    }
  },
);

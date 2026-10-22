import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectAcceptance, mutateAcceptance } from "../../src/broker/acceptance.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentNames, createRunFixture, isAlive, newestSwarmId, spawnsOf, waitForWorkersIdle } from "./run-fixture.js";

test(
  "full runtime admits exactly 15 real workers and closes at 11 matching whole-task votes",
  { timeout: 30_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    const env = { ...run.env, settings: { ...run.env.settings, maxAgents: 15 } };
    const cancel = new AbortController();
    const running = startSwarm(
      env,
      {
        name: "fifteen-runtime",
        taskPrompt: "Verify the requested full team without resizing.",
        acceptanceCriteria: ["Exactly fifteen real fixture workers start and ordinary quorum holds."],
        agentAmount: 15,
      },
      { signal: cancel.signal },
    );
    const swarmId = newestSwarmId(run.db);
    try {
      await waitForWorkersIdle(run, swarmId);
      const names = agentNames(run.db, swarmId);
      assert.equal(names.length, 15);
      assert.equal(spawnsOf(run.fake).length, 15);
      assert.equal(getRunConfiguration(run.db, swarmId)?.effective.workers.length, 15);
      const modes = run.fake.log().filter((record) => record.type === "set_steering_mode");
      assert.ok(modes.length >= 15);
      assert.ok(modes.every((record) => record.mode === "all"));
      const vote = (name: string, verdict: "accepted" | "blocked") =>
        mutateAcceptance(
          run.db,
          swarmId,
          name,
          {
            action: "vote",
            verdict,
            reason: "Full-runtime real-child startup evidence",
          },
          Date.now(),
        );
      for (const name of names.slice(0, 10)) vote(name, "accepted");
      for (const name of names.slice(11)) vote(name, "blocked");
      const pending = inspectAcceptance(run.db, swarmId);
      assert.equal(pending.threshold, 11);
      assert.equal(pending.verdict, "incomplete");
      vote(names[10], "accepted");
      const completed = await running;
      assert.equal(completed.end, "finished");
      assert.equal(completed.acceptance.verdict, "accepted");
      assert.equal(completed.acceptance.counts.accepted, 11);
      assert.equal(completed.acceptance.counts.blocked, 4);
      assert.equal(completed.acceptance.totalAgents, 15);
      const childPids = run.fake
        .log()
        .filter((record) => record.fake === "spawn")
        .map((record) => Number(record.pid));
      assert.ok(
        childPids.every((pid) => !isAlive(pid)),
        "joined runtime shutdown reaps workers and Watcher",
      );
    } finally {
      cancel.abort();
      try {
        await running;
      } finally {
        run.cleanup();
      }
    }
  },
);

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { reserveCount } from "../../src/broker/late-peers.js";
import { resumeSwarm, startSwarm } from "../../src/broker/swarm-run.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  spawnsOf,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());

interface Span {
  agent: string;
  run: number;
  startedAt: number;
  endedAt: number | null;
}

function spans(run: RunFixture, swarmId: number): Span[] {
  return run.db.sql
    .prepare("SELECT agent, run, started_at, ended_at FROM agent_runs WHERE swarm_id = ? ORDER BY id")
    .all(swarmId)
    .map((row) => ({
      agent: String(row.agent),
      run: Number(row.run),
      startedAt: Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
    }));
}

function kickoffs(run: RunFixture): string[] {
  return promptTexts(run.fake).filter((text) => text.startsWith("Task for the swarm:"));
}

describe("late peers", () => {
  it("counts the reserve: at least one early agent, none on resume", () => {
    assert.deepEqual(
      [reserveCount(3, 1, 1), reserveCount(3, 5, 1), reserveCount(1, 1, 1), reserveCount(3, 0, 1)],
      [1, 2, 0, 0],
    );
    assert.equal(reserveCount(3, 1, 2), 0);
  });

  it("launches the reserve with the same kickoff once the others settle", { timeout: 30_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle, { latePeers: 1 });
    fixture = run;
    const outcome = startSwarm(run.env, { name: "late", taskPrompt: "Build it.", agentAmount: 3 }, {});
    const swarmId = newestSwarmId(run.db);
    const [first, second, late] = agentNames(run.db, swarmId);
    await waitFor(
      () => agentStatus(run.db, swarmId, first) === "idle" && agentStatus(run.db, swarmId, second) === "idle",
      "early peers idle",
    );
    assert.equal(agentStatus(run.db, swarmId, late), "pending");

    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(agentStatus(run.db, swarmId, late), "idle");
    const all = spans(run, swarmId);
    const lateStart = all.find((span) => span.agent === late)?.startedAt ?? 0;
    for (const early of [first, second]) {
      const span = all.find((entry) => entry.agent === early);
      assert.ok(span?.endedAt !== null && (span?.endedAt ?? Infinity) <= lateStart, `${late} started after ${early}`);
    }
    assert.equal(spawnsOf(run.fake).length, 3);
    const texts = kickoffs(run);
    assert.equal(texts.length, 3);
    assert.deepEqual(new Set(texts).size, 1, "the late peer gets exactly the others' kickoff");
    assert.ok((result.swarm.finishedAt ?? 0) >= Math.max(...all.map((span) => span.endedAt ?? Infinity)));
  });

  for (const [latePeers, agentAmount] of [
    [0, 3],
    [1, 1],
  ]) {
    it(
      `latePeers ${latePeers} with ${agentAmount} agent(s) launches everyone up front`,
      { timeout: 30_000 },
      async () => {
        const run = createRunFixture(SCENARIOS.settle, { latePeers, staggerSeconds: 0 });
        fixture = run;
        const outcome = startSwarm(run.env, { name: "plain", taskPrompt: "Build it.", agentAmount }, {});
        const swarmId = newestSwarmId(run.db);
        const names = agentNames(run.db, swarmId);
        await waitFor(() => names.every((name) => agentStatus(run.db, swarmId, name) === "idle"), "all idle");
        assert.equal(spawnsOf(run.fake).length, agentAmount);
        assert.equal((await outcome).end, "finished");
        assert.equal(spawnsOf(run.fake).length, agentAmount, "nobody launches late");
      },
    );
  }

  it(
    "stop before the reserve launches stops it; resume kicks it off with the others",
    { timeout: 30_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle, { latePeers: 1, timings: { completionGraceMs: 60_000 } });
      fixture = run;
      const controller = new AbortController();
      const outcome = startSwarm(
        run.env,
        { name: "halt", taskPrompt: "Build it.", agentAmount: 2 },
        { signal: controller.signal },
      );
      const swarmId = newestSwarmId(run.db);
      const [first, late] = agentNames(run.db, swarmId);
      await waitFor(() => agentStatus(run.db, swarmId, first) === "idle", "early peer idle");
      controller.abort();
      assert.equal((await outcome).end, "stopped");
      assert.equal(agentStatus(run.db, swarmId, late), "stopped");
      assert.equal(spawnsOf(run.fake).length, 1);

      run.env.timings = { ...run.env.timings, completionGraceMs: 300 };
      const resumed = await resumeSwarm(run.env, { swarmId, message: "Carry on." }, {});
      assert.equal(resumed.end, "finished");
      assert.equal(spawnsOf(run.fake).length, 3, "both relaunch together on resume");
      const lateKickoff = kickoffs(run).at(-1) ?? "";
      assert.ok(lateKickoff.includes('"Carry on."'), "the never-started peer gets the kickoff with the feedback");
      const resumeSpans = spans(run, swarmId).filter((span) => span.run === 2);
      assert.deepEqual(new Set(resumeSpans.map((span) => span.agent)), new Set([first, late]));
    },
  );
});

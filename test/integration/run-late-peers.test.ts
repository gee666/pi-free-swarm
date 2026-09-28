import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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

/** Every span of `late` begins after each of `others` went idle. */
function assertStartsAfter(all: Span[], late: string, others: string[]): void {
  const lateStart = all.find((span) => span.agent === late)?.startedAt ?? 0;
  for (const other of others) {
    const span = all.find((entry) => entry.agent === other);
    assert.ok(span?.endedAt !== null && (span?.endedAt ?? Infinity) <= lateStart, `${late} started after ${other}`);
  }
}

function kickoffs(run: RunFixture): string[] {
  return promptTexts(run.fake).filter((text) => text.startsWith("Task for the swarm:"));
}

describe("late peers", () => {
  it(
    "4 agents at ratio 0.2: the final reserve joins with the same kickoff once the others settle",
    { timeout: 30_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle, { latePeerRatio: 0.2 });
      fixture = run;
      const outcome = startSwarm(run.env, { name: "late", taskPrompt: "Build it.", agentAmount: 4 }, {});
      const swarmId = newestSwarmId(run.db);
      const names = agentNames(run.db, swarmId);
      const early = names.slice(0, 3);
      const late = names[3] ?? "";
      await waitFor(() => early.every((name) => agentStatus(run.db, swarmId, name) === "idle"), "early peers idle");
      assert.equal(agentStatus(run.db, swarmId, late), "pending");

      const result = await outcome;
      assert.equal(result.end, "finished");
      assert.equal(agentStatus(run.db, swarmId, late), "idle");
      const all = spans(run, swarmId);
      assertStartsAfter(all, late, early);
      assert.equal(spawnsOf(run.fake).length, 4);
      const texts = kickoffs(run);
      assert.equal(texts.length, 4);
      assert.deepEqual(new Set(texts).size, 1, "the late peer gets exactly the others' kickoff");
      assert.ok((result.swarm.finishedAt ?? 0) >= Math.max(...all.map((span) => span.endedAt ?? Infinity)));
    },
  );

  it(
    "10 agents at ratio 0.2: one late peer joins after 4 early settle, the last at quiescence",
    { timeout: 30_000 },
    async () => {
      const run = createRunFixture(SCENARIOS.settle, { latePeerRatio: 0.2, staggerSeconds: 0.4 });
      fixture = run;
      const outcome = startSwarm(run.env, { name: "rolling", taskPrompt: "Build it.", agentAmount: 10 }, {});
      const swarmId = newestSwarmId(run.db);
      const names = agentNames(run.db, swarmId);
      const early = names.slice(0, 8);
      const [rolling = "", last = ""] = names.slice(8);
      const idleEarly = () => early.filter((name) => agentStatus(run.db, swarmId, name) === "idle").length;
      // Early peers stay idle once settled, so the count seen at the release is never below the one it used.
      await waitFor(() => agentStatus(run.db, swarmId, rolling) !== "pending", "rolling late peer launched");
      const settledAtRelease = idleEarly();
      assert.ok(settledAtRelease >= 4 && settledAtRelease < 8, `released with ${settledAtRelease} early peers idle`);
      assert.equal(agentStatus(run.db, swarmId, last), "pending");

      const result = await outcome;
      assert.equal(result.end, "finished");
      assertStartsAfter(spans(run, swarmId), last, [...early, rolling]);
      const texts = kickoffs(run);
      assert.equal(texts.length, 10);
      assert.equal(new Set(texts).size, 1, "late peers get exactly the others' kickoff");
    },
  );

  for (const [latePeerRatio, agentAmount] of [
    [0, 3],
    [0.2, 1],
  ]) {
    it(
      `ratio ${latePeerRatio} with ${agentAmount} agent(s) launches everyone up front`,
      { timeout: 30_000 },
      async () => {
        const run = createRunFixture(SCENARIOS.settle, { latePeerRatio, staggerSeconds: 0 });
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
      const run = createRunFixture(SCENARIOS.settle, { latePeerRatio: 0.2, timings: { completionGraceMs: 60_000 } });
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

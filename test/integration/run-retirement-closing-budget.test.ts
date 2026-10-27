import assert from "node:assert/strict";
import { test } from "node:test";
import { RunAgent } from "../../src/broker/run-agent.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { requestRetirement } from "../../src/broker/retirement.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { getRuntimeConfiguration } from "../../src/store/runtime-configuration.js";
import { activeWorkerNames } from "../../src/store/active-roster.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { agentStatus, createRunFixture, newestSwarmId, waitFor } from "./run-fixture.js";

test(
  "final known cost at retired-worker join blocks fresh admission before the next budget poll",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    const clock = new FakeClock(Date.now());
    const env = {
      ...run.env,
      clock,
      settings: { ...run.env.settings, budgetMoneyUsd: 1 },
      availableModels: [{ provider: "fixture", id: "test", thinkingLevels: ["off"], pricingKnown: true }],
    };
    const cancel = new AbortController();
    const outcome = startSwarm(
      env,
      {
        name: "closing-cost-retirement",
        taskPrompt: "Retain late attributable costs.",
        acceptanceCriteria: ["No fresh work starts after known exhaustion."],
        agentAmount: 1,
      },
      { signal: cancel.signal },
    );
    const swarmId = newestSwarmId(run.db);
    const [oldName] = activeWorkerNames(run.db, swarmId);
    const originalStop = RunAgent.prototype.stop;
    const originalLaunch = RunAgent.prototype.launchFirst;
    let charged = false;
    let freshLaunches = 0;
    clock.advance(0);
    try {
      await waitFor(() => agentStatus(run.db, swarmId, oldName) === "idle", "first worker idle");
      RunAgent.prototype.stop = async function (this: RunAgent) {
        await originalStop.call(this);
        if (this.name === oldName && !charged) {
          charged = true;
          recordUsage(
            run.db,
            swarmId,
            oldName,
            { kind: "message", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1, model: "test" },
            clock.now(),
            1,
          );
        }
      };
      RunAgent.prototype.launchFirst = function (this: RunAgent) {
        if (this.name !== oldName && this.name !== "Watcher") freshLaunches++;
        return originalLaunch.call(this);
      };
      const request = requestRetirement(
        run.db,
        swarmId,
        oldName,
        1,
        "The final operation may report cost while closing. Do not repeat it.",
        clock.now(),
      );
      clock.advance(25);
      await waitFor(() => charged, "known final cost arrives immediately before old join resolves");
      clock.advance(0);
      await waitFor(() => {
        const status = getRuntimeConfiguration(run.db, swarmId, clock.now())?.requests.find(
          (item) => item.id === request.requestId,
        )?.status;
        return status === "applied" || status === "rejected";
      }, "retirement control leaves its join phase");
      assert.equal(
        freshLaunches,
        0,
        "admission must recheck the new known cost without waiting for the next completion tick",
      );
      assert.equal(run.fake.log().filter((entry) => entry.fake === "spawn" && entry.agent !== "Watcher").length, 1);
      clock.advance(25);
      const stopped = await outcome;
      assert.equal(stopped.stopReason, "budget-exhausted");

      assert.ok(stopped.budget && stopped.budget.costUsd >= 1);
    } finally {
      RunAgent.prototype.stop = originalStop;
      RunAgent.prototype.launchFirst = originalLaunch;
      cancel.abort();
      await outcome;
      run.cleanup();
    }
  },
);

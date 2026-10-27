import assert from "node:assert/strict";
import { after, test } from "node:test";
import { extractUsage } from "../../src/agents/rpc-events.js";
import { createAgentHooks } from "../../src/broker/agent-hooks.js";
import { assertBudgetPricing } from "../../src/broker/budget.js";
import { readBudget, hasBudgetAccountingGap } from "../../src/store/budget.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";
import { systemClock } from "../../src/clock.js";

const temp = createTempDb();
after(() => temp.cleanup());

test("missing compaction costs remain incomplete, stop money execution and refuse raised-ceiling resume", () => {
  const swarm = seedSwarm(temp.db);
  saveRunConfiguration(
    temp.db,
    swarm.id,
    1,
    {
      version: 1,
      workers: [{ name: "Maria", provider: "fixture", modelId: "worker", thinkingLevel: null }],
      launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
      timing: {
        staggerSeconds: 0,
        idleReminderDelay: 0,
        heartbeatMs: 1,
        deliveryPollMs: 1,
        completionCheckMs: 1,
        progressMs: 1,
        resumeStaggerMs: 0,
        reviveBackoffMs: [],
      },
      limits: { maxRpcFrameBytes: 100000 },
      budget: { moneyUsd: 1, timeSeconds: null, gracefulShutdown: false },
    },
    T0,
  );
  const errors: unknown[] = [];
  const hooks = createAgentHooks({
    db: temp.db,
    swarmId: swarm.id,
    name: "Maria",
    clock: systemClock,
    isEnding: () => false,
    onCrash: () => undefined,
    onError: (error) => errors.push(error),
  });
  const sample = extractUsage({ type: "compaction_end", result: { usage: { input: 100, output: 10 } } });
  assert.ok(sample);
  assert.equal(sample.costKnown, false);
  hooks.onUsage(sample);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /accounting is incomplete/);
  assert.equal(hasBudgetAccountingGap(temp.db, swarm.id), true);
  assert.match(readBudget(temp.db, swarm.id, { budgetMoneyUsd: 1 }, T0).accounting, /missing cost is not free usage/);
  const model = { provider: "fixture", modelId: "worker", thinkingLevel: null };
  assert.throws(
    () =>
      assertBudgetPricing(
        {
          db: temp.db,
          settings: { ...loadSettings(temp.cwd).settings, budgetMoneyUsd: 100 },
          launch: { extensionArgs: [], projectTrusted: false, model },
        },
        new Map([["Maria", model]]),
        swarm.id,
      ),
    /cannot be repaired by raising/,
  );
});

test("invalid USD totals are explicitly unknown while legitimate reported zero is known", () => {
  for (const total of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, "0"]) {
    const sample = extractUsage({ type: "message_end", message: { role: "assistant", usage: { cost: { total } } } });
    assert.equal(sample?.costKnown, false);
  }
  const zero = extractUsage({ type: "message_end", message: { role: "assistant", usage: { cost: { total: 0 } } } });
  assert.equal(zero?.cost, 0);
  assert.notEqual(zero?.costKnown, false);
});

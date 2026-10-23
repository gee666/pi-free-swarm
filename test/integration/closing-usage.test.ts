import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { createAgentHooks } from "../../src/broker/agent-hooks.js";
import { endRun } from "../../src/broker/swarms.js";
import { systemClock } from "../../src/clock.js";
import { PI_ARGS_PREFIX_ENV, PI_COMMAND_ENV } from "../../src/constants.js";
import { getStats } from "../../src/store/stats-queries.js";
import { createFakePiRun, waitFor } from "../fixtures/fake-pi/harness.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

// Real pipes and process-group shutdown, with no provider or tool execution.
test("real child flushes attributable category costs during joined stop before the run closes", async () => {
  const temp = createTempDb();
  const fixture = createFakePiRun({});
  const swarm = seedSwarm(temp.db, { agents: ["Maria"], now: Date.now() });
  const previous = new Map([PI_COMMAND_ENV, PI_ARGS_PREFIX_ENV].map((key) => [key, process.env[key]]));
  process.env[PI_COMMAND_ENV] = process.execPath;
  process.env[PI_ARGS_PREFIX_ENV] = JSON.stringify([
    fileURLToPath(new URL("../fixtures/closing-usage-child.ts", import.meta.url)),
  ]);
  let ending = false;
  const errors: unknown[] = [];
  const supervisor = new AgentSupervisor({
    name: "Maria",
    watchdog: { startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, startupRetries: 0 },
    hooks: createAgentHooks({
      db: temp.db,
      swarmId: swarm.id,
      run: 1,
      name: "Maria",
      clock: systemClock,
      isEnding: () => ending,
      onCrash: (crash) => errors.push(crash.message),
      onError: (error) => errors.push(error),
    }),
  });
  try {
    const spec = fixture.spec();
    spec.context.model = { provider: "fixture", modelId: "closing-usage", thinkingLevel: "off" };
    assert.deepEqual(await supervisor.launch(spec, { text: "Work until stopped", messageIds: [] }), { accepted: true });
    await waitFor(() => supervisor.status === "working", "real fixture working");
    ending = true;
    await supervisor.stop();
    assert.deepEqual(errors, []);
    assert.equal(supervisor.status, "stopped");
    endRun(temp.db, swarm.id, process.pid, "stopped", Date.now());
    const totals = getStats(temp.db, swarm.id, Date.now())?.totals;
    assert.equal(totals?.cost, 0.5);
    assert.deepEqual(totals?.costBreakdown, {
      records: 1,
      input: { usd: 0.1, knownRecords: 1 },
      output: { usd: 0.2, knownRecords: 1 },
      cacheRead: { usd: 0.15, knownRecords: 1 },
      cacheWrite: { usd: 0.05, knownRecords: 1 },
    });
    const usage = temp.db.sql.prepare("SELECT run, model, cost FROM usage WHERE swarm_id = ?").get(swarm.id);
    assert.equal(usage?.run, 1);
    assert.equal(usage?.model, "closing-usage");
    assert.equal(usage?.cost, 0.5);
  } finally {
    ending = true;
    await supervisor.stop();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixture.cleanup();
    temp.cleanup();
  }
});

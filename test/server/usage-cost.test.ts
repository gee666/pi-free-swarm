import assert from "node:assert/strict";
import { test } from "node:test";
import type { StatsResponse } from "../../src/api-types.js";
import { extractUsage } from "../../src/agents/rpc-events.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { getJson, openSse, startTestBoard } from "./helpers.js";

test("Stats HTTP and live usage events expose reported cost subtotals with historical coverage", async (t) => {
  const clock = new FakeClock(T0);
  const board = await startTestBoard({ clock });
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db);
  recordUsage(
    db,
    swarm.id,
    "Maria",
    { kind: "message", input: 2, output: 3, cacheRead: 5, cacheWrite: 7, cost: 1, model: null },
    T0,
  );
  const stream = await openSse(`${board.base}/events?swarm=${swarm.id}`);
  t.after(() => stream.close());
  const sample = extractUsage({
    type: "compaction_end",
    result: {
      usage: {
        input: 10,
        output: 20,
        cacheRead: 800,
        cacheWrite: 1600,
        cost: { input: 0.125, output: 0.25, cacheRead: 0.0625, cacheWrite: 0.0625, total: 0.5 },
      },
    },
  });
  assert.ok(sample);
  recordUsage(db, swarm.id, "Maria", sample, T0 + 1);
  clock.advance(EVENTS_TAIL_MS);
  const frame = await stream.next(
    ({ event }) => event?.type === "usage.updated" && event.payload.usage.costBreakdown?.records === 2,
  );
  assert.ok(frame.event?.type === "usage.updated");
  const usage = frame.event.payload.usage;
  assert.equal(usage.cost, 1.5);
  assert.equal(usage.cacheRead, 805);
  assert.equal(usage.cacheWrite, 1607);
  assert.deepEqual(usage.costBreakdown, {
    records: 2,
    input: { usd: 0.125, knownRecords: 1 },
    output: { usd: 0.25, knownRecords: 1 },
    cacheRead: { usd: 0.0625, knownRecords: 1 },
    cacheWrite: { usd: 0.0625, knownRecords: 1 },
  });
  const response = await getJson<StatsResponse>(`${board.base}/api/swarms/${swarm.id}/stats`);
  assert.equal(response.status, 200);
  assert.equal(response.body.totals.cost, 1.5);
  assert.deepEqual(response.body.totals.costBreakdown, usage.costBreakdown);
  assert.deepEqual(response.body.agents.find((agent) => agent.name === "Maria")?.costBreakdown, usage.costBreakdown);
});

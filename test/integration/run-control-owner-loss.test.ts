import assert from "node:assert/strict";
import { test } from "node:test";
import { requestRetirement } from "../../src/broker/retirement.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { activeWorkerNames } from "../../src/store/active-roster.js";
import { FakeClock } from "../agents/fake-clock.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { killFixtureChild } from "./control-child-cleanup.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  isAlive,
  newestSwarmId,
  waitFor,
  waitForWorkersIdle,
} from "./run-fixture.js";

test(
  "a retired-child cleanup cannot admit a replacement after the database owner changes",
  { timeout: 20_000 },
  async () => {
    const run = createRunFixture({ spawns: [{ ...SCENARIOS.settle, ignoreSigterm: true }, SCENARIOS.settle] });
    const clock = new FakeClock();
    const env = { ...run.env, clock };
    const cancel = new AbortController();
    const running = startSwarm(
      env,
      {
        name: "owner-loss",
        taskPrompt: "Fence retired-owner admission.",
        acceptanceCriteria: ["New work belongs only to its current run owner."],
        agentAmount: 2,
      },
      { signal: cancel.signal },
    );
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    const swarmId = newestSwarmId(run.db);
    const names = agentNames(run.db, swarmId);
    clock.advance(0);
    try {
      await waitForWorkersIdle(run, swarmId);
      requestRetirement(
        run.db,
        swarmId,
        names[0],
        1,
        "The replacement must verify ownership before continuing.",
        clock.now(),
      );
      clock.advance(25);
      await waitFor(
        () => run.fake.log().some((record) => record.fake === "signal" && record.agent === names[0]),
        "retired child cleanup begins",
      );
      const replacement = activeWorkerNames(run.db, swarmId).find((name) => !names.includes(name));
      assert.ok(replacement);
      const retiredSpawn = run.fake.log().find((record) => record.fake === "spawn" && record.agent === names[0]);
      assert.ok(retiredSpawn && typeof retiredSpawn.pid === "number");
      assert.equal(isAlive(retiredSpawn.pid), true);
      assert.equal(endRun(run.db, swarmId, process.pid, "interrupted", clock.now(), 1), true);
      beginResume(run.db, swarmId, process.pid + 1, clock.now());
      const boundary = Number(run.db.sql.prepare("SELECT MAX(id) AS id FROM events").get()?.id);
      killFixtureChild(retiredSpawn.pid);
      await settled;
      assert.equal(agentStatus(run.db, swarmId, replacement), "pending");
      const staleStarts = run.db.sql
        .prepare(
          "SELECT id FROM events WHERE id > ? AND swarm_id = ? AND type = 'participant.updated' AND json_extract(payload, '$.participant.name') = ? AND json_extract(payload, '$.participant.status') = 'starting'",
        )
        .all(boundary, swarmId, replacement);
      assert.equal(staleStarts.length, 0, "retired owner cannot advance replacement status or acquire a child");
      assert.equal(
        run.fake.log().some((record) => record.fake === "spawn" && record.agent === replacement),
        false,
      );
    } finally {
      cancel.abort();
      for (const spawn of run.fake.log().filter((record) => record.fake === "spawn")) {
        if (typeof spawn.pid === "number" && isAlive(spawn.pid)) killFixtureChild(spawn.pid);
      }
      try {
        await settled;
      } finally {
        run.cleanup();
      }
    }
  },
);

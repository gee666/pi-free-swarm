import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { readBudget } from "../../src/store/budget.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { getRuntimeConfiguration } from "../../src/store/runtime-configuration.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentNames, agentStatus, createRunFixture, waitFor } from "./run-fixture.js";

test(
  "a live approved budget raise reaches another owner and survives resume without changing the file ceiling",
  { timeout: 40_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    run.env.settings.budgetTimeSeconds = 1;
    writeFileSync(
      run.fake.env.FAKE_PI_SCENARIO,
      JSON.stringify({
        agents: { Watcher: {} },
        spawns: [
          { runs: [[{ type: "waitForFile", file: path.join(run.cwd, "uncompleted-operation") }, { type: "reply" }]] },
          SCENARIOS.settle,
        ],
      }),
    );
    const owner = await configurationOwner(run, 1);
    const { swarmId } = owner;
    try {
      const [name] = agentNames(run.db, swarmId);
      await waitFor(() => agentStatus(run.db, swarmId, name) === "working", "initial active operation");
      const original = run.db.sql
        .prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1")
        .get(swarmId)?.configuration;
      await owner.applied({ type: "raiseBudget", timeSeconds: 10 });
      assert.equal(getRuntimeConfiguration(run.db, swarmId, Date.now())?.budget?.timeSeconds, 10);
      await owner.advance(1000);
      assert.equal(
        getSwarm(run.db, swarmId, Date.now())?.status,
        "running",
        "the old one-second ceiling no longer stops the live owner",
      );
      await owner.close();
      assert.equal(getSwarm(run.db, swarmId, Date.now())?.status, "stopped");
      const spent = readBudget(run.db, swarmId, run.env.settings, Date.now()).activeTimeMs;
      assert.ok(spent >= 1000);
      assert.equal(
        run.db.sql.prepare("SELECT configuration FROM run_configurations WHERE swarm_id = ? AND run = 1").get(swarmId)
          ?.configuration,
        original,
      );
      assert.match(readFileSync(path.join(run.db.dataDir, "settings.json"), "utf8"), /"budgetTimeSeconds":1[,}]/);
      const resumed = await configurationOwner(run, 1, swarmId);
      try {
        await waitFor(() => agentStatus(run.db, swarmId, name) === "idle", "explicit resumed worker idle");
        assert.equal(getRunConfiguration(run.db, swarmId)?.effective.budget.timeSeconds, 10);
        const continued = readBudget(run.db, swarmId, run.env.settings, Date.now());
        assert.equal(continued.timeSeconds, 10);
        assert.ok(continued.activeTimeMs >= spent, "resume retains cumulative consumption");
        mutateAcceptance(
          run.db,
          swarmId,
          name,
          { action: "vote", verdict: "accepted", reason: "Approved runtime ceiling and saved progress verified." },
          Date.now(),
        );
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

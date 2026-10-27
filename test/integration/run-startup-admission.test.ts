import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { WATCHER_NAME } from "../../src/constants.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { createRunFixture, newestSwarmId, spawnsOf, waitFor, waitForWorkersIdle, finishWork } from "./run-fixture.js";

test("fatal shared startup rejects and launches no subsequent real worker", async () => {
  const run = createRunFixture(SCENARIOS.extensionLoadFailure);
  try {
    await assert.equal(spawnsOf(run.fake).length, 1);
  } finally {
    run.cleanup();
  }
});

test("first real ready worker releases admission without waiting for active operation completion", async () => {
  const run = createRunFixture({});
  const release = path.join(run.cwd, "release-first-run");
  writeFileSync(
    path.join(run.fake.dir, "scenario.json"),
    JSON.stringify({
      agents: { [WATCHER_NAME]: {} },
      runs: [[{ type: "waitForFile", file: release }, { type: "reply" }]],
    }),
  );
  const running = startSwarm(
    run.env,
    {
      name: "ready startup",
      taskPrompt: "fixture",
      acceptanceCriteria: ["fixture complete"],
      agentAmount: 3,
    },
    {},
  );
  try {
    const id = newestSwarmId(run.db);
    await waitFor(
      () => spawnsOf(run.fake).length === 3,
      "all admitted while first worker operation is blocked",
      10_000,
    );
    const events = run.fake.log();
    assert.equal(events.filter((event) => event.type === "prompt" && event.agent !== "Watcher").length >= 1, true);
    writeFileSync(release, "release");
    await waitForWorkersIdle(run, id);
    finishWork(run.db, id);
    assert.equal((await running).end, "finished");
  } finally {
    await import("../../src/broker/swarm-run.js").then(({ stopAllRuns }) => stopAllRuns());
    await running.catch(() => undefined);
    run.cleanup();
  }
});

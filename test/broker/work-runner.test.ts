import assert from "node:assert/strict";
import { test } from "node:test";
import { RunCompletion } from "../../src/broker/run-completion.js";
import { updateProjectIntent, readProject } from "../../src/broker/project.js";
import { onWorkChanged } from "../../src/broker/work-write.js";
import { loadSettings } from "../../src/settings.js";
import { systemClock } from "../../src/clock.js";
import { workFixture } from "../helpers/work-graph.js";

test("completion poll uses graph gates and refuses completion during budget/pause drain", async (t) => {
  const f = workFixture(t);
  f.settle();
  let closed = 0;
  let canRun = false;
  const completion = new RunCompletion({
    env: {
      cwd: f.cwd,
      db: f.db,
      runnerPid: process.pid,
      clock: systemClock,
      settings: loadSettings(f.cwd).settings,
      launch: { extensionArgs: [], projectTrusted: false, model: null },
      boardUrl: () => null,
      notifyUser() {},
    },
    swarmId: f.swarmId,
    run: 1,
    controls: { async update() {} },
    reminders: { update: () => false },
    canRun: () => canRun,
    ending: () => false,
    closed: () => {
      closed++;
    },
    lost: () => assert.fail("Run ownership lost"),
  });
  await completion.check();
  assert.equal(closed, 0);
  assert.equal(readProject(f.db, f.swarmId).outcome, null);
  canRun = true;
  await completion.check();
  assert.equal(closed, 1);
  assert.equal(readProject(f.db, f.swarmId).outcome, null, "outcome waits for the final atomic recheck");
});

test("committed work mutations invoke the runner completion check immediately", async (t) => {
  const f = workFixture(t);
  f.settle();
  let closed = false;
  const completion = new RunCompletion({
    env: {
      cwd: f.cwd,
      db: f.db,
      runnerPid: process.pid,
      clock: systemClock,
      settings: loadSettings(f.cwd).settings,
      launch: { extensionArgs: [], projectTrusted: false, model: null },
      boardUrl: () => null,
      notifyUser() {},
    },
    swarmId: f.swarmId,
    run: 1,
    controls: { async update() {} },
    reminders: { update: () => false },
    canRun: () => true,
    ending: () => closed,
    closed: () => {
      closed = true;
    },
    lost: () => assert.fail("Run ownership lost"),
  });
  const remove = onWorkChanged((id) => {
    if (id === f.swarmId) void completion.check();
  });
  t.after(remove);
  updateProjectIntent(f.db, { ...f.input(), summary: "Verified output", path: "intent.md" });
  assert.equal(closed, true);
  assert.equal(readProject(f.db, f.swarmId).outcome, null, "outcome waits for the final atomic recheck");
});

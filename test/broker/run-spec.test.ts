import assert from "node:assert/strict";
import path from "node:path";
import { after, it } from "node:test";
import { buildRunSpec } from "../../src/broker/run-spec.js";
import type { RunEnvironment } from "../../src/broker/run-types.js";
import { systemClock } from "../../src/clock.js";
import { RUN_ENV } from "../../src/constants.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

it("passes the captured run into each worker launch, even if the database has advanced", () => {
  const { db, cwd } = temp;
  const swarm = seedSwarm(db);
  const env: RunEnvironment = {
    cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings: loadSettings(cwd).settings,
    launch: { extensionArgs: [], projectTrusted: false, model: null },
    boardUrl: () => null,
    notifyUser: () => {},
  };
  const session = path.join(db.dataDir, "sessions", String(swarm.id), "Maria", "session.jsonl");
  db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(swarm.id);
  assert.equal(buildRunSpec(env, swarm.id, "Maria", session, 1).env[RUN_ENV], "1");
  assert.equal(buildRunSpec(env, swarm.id, "Maria", session, 2).env[RUN_ENV], "2");
});

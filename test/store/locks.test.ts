import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import {
  claimRunLock,
  claimServerHost,
  heartbeatRunLock,
  heartbeatServerHost,
  isPidAlive,
  isRunLockFresh,
  readServerHost,
  releaseRunLock,
  releaseServerHost,
  setServerHostPort,
} from "../../src/store/locks.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const alive = () => true;
const dead = () => false;

describe("isPidAlive", () => {
  it("sees this process and not an exited one", () => {
    assert.equal(isPidAlive(process.pid), true);
    const child = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(isPidAlive(child.pid ?? 0), false);
  });
});

describe("run lock", () => {
  it("is fresh only with a pid, a recent heartbeat and a live process", () => {
    assert.equal(isRunLockFresh({ runnerPid: 7, runnerHeartbeatAt: T0 }, T0 + 20_000, alive), true);
    assert.equal(isRunLockFresh({ runnerPid: 7, runnerHeartbeatAt: T0 }, T0 + 20_001, alive), false);
    assert.equal(isRunLockFresh({ runnerPid: 7, runnerHeartbeatAt: T0 }, T0, dead), false);
    assert.equal(isRunLockFresh({ runnerPid: null, runnerHeartbeatAt: null }, T0, alive), false);
  });

  it("claims, heartbeats, refuses a fresh holder and takes over a stale one", () => {
    const swarm = seedSwarm(db, { runnerPid: 100 });
    assert.deepEqual(claimRunLock(db, swarm.id, 200, T0 + 1_000, alive), { ok: false, holderPid: 100 });
    assert.deepEqual(claimRunLock(db, swarm.id, 100, T0 + 1_000, alive), { ok: true });
    assert.equal(heartbeatRunLock(db, swarm.id, 100, T0 + 5_000), true);
    assert.equal(heartbeatRunLock(db, swarm.id, 200, T0 + 5_000), false);
    // Dead pid: stale at once.
    assert.deepEqual(claimRunLock(db, swarm.id, 200, T0 + 6_000, dead), { ok: true });
    assert.equal(heartbeatRunLock(db, swarm.id, 100, T0 + 7_000), false);
    // Old heartbeat: stale even with a live pid.
    assert.deepEqual(claimRunLock(db, swarm.id, 300, T0 + 60_000, alive), { ok: true });
    releaseRunLock(db, swarm.id, 200);
    assert.equal(heartbeatRunLock(db, swarm.id, 300, T0 + 61_000), true);
    releaseRunLock(db, swarm.id, 300);
    assert.equal(heartbeatRunLock(db, swarm.id, 300, T0 + 62_000), false);
    assert.deepEqual(claimRunLock(db, swarm.id, 400, T0 + 62_000, alive), { ok: true });
  });
});

describe("server host", () => {
  it("elects one host, keeps the port across a clean handover and detects stale hosts", () => {
    assert.equal(readServerHost(db, T0, alive), null);
    assert.deepEqual(claimServerHost(db, 1, T0, alive), { claimed: true, previousPort: null });
    assert.equal(readServerHost(db, T0, alive), null, "no port bound yet");
    setServerHostPort(db, 1, 3010);
    assert.deepEqual(readServerHost(db, T0, alive), { pid: 1, port: 3010, heartbeatAt: T0 });

    const lost = claimServerHost(db, 2, T0 + 1_000, alive);
    assert.deepEqual(lost, { claimed: false, holder: { pid: 1, port: 3010, heartbeatAt: T0 } });
    assert.deepEqual(claimServerHost(db, 1, T0 + 2_000, alive), { claimed: true, previousPort: 3010 });
    assert.equal(heartbeatServerHost(db, 1, T0 + 5_000), true);

    releaseServerHost(db, 1);
    assert.equal(readServerHost(db, T0 + 5_000, alive), null);
    assert.deepEqual(claimServerHost(db, 2, T0 + 6_000, alive), { claimed: true, previousPort: 3010 });
    assert.equal(heartbeatServerHost(db, 1, T0 + 7_000), false, "the old host lost the row");
    setServerHostPort(db, 2, 3010);

    assert.equal(readServerHost(db, T0 + 6_000 + 15_001, alive), null, "heartbeat too old");
    assert.equal(readServerHost(db, T0 + 6_000, dead), null, "pid dead");
    assert.deepEqual(claimServerHost(db, 3, T0 + 7_000, dead), { claimed: true, previousPort: 3010 });
  });
});

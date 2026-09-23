import assert from "node:assert/strict";
import { it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { sweepStaleRuns } from "../../src/broker/swarms.js";
import { latestEventId } from "../../src/store/events.js";
import { getMessages } from "../../src/store/message-queries.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

it("refreshes a paused owned run, but sweeps abandoned same-pid and stale foreign runs", () => {
  const temp = createTempDb();
  const { db } = temp;
  try {
    const active = seedSwarm(db);
    const abandoned = seedSwarm(db);
    const foreign = seedSwarm(db, { runnerPid: process.ppid });
    const message = sendMessage(db, active.id, "User", ["Maria"], "keep working", T0);
    const now = T0 + 60_000;
    const calls: [number, number][] = [];
    const swept = sweepStaleRuns(
      db,
      now,
      () => true,
      (id, pid) => {
        calls.push([id, pid]);
        return id === active.id;
      },
    );
    assert.deepEqual(swept, [abandoned.id, foreign.id]);
    assert.deepEqual(calls, [
      [active.id, process.pid],
      [abandoned.id, process.pid],
    ]);
    assert.equal(getSwarm(db, active.id, now)?.acceptsMessages, true);
    assert.equal(getMessages(db, [message.id])[0].recipients[0].status, "pending");
    assert.equal(
      db.sql.prepare("SELECT runner_heartbeat_at FROM swarms WHERE id = ?").get(active.id)?.runner_heartbeat_at,
      now,
    );
    assert.equal(getSwarm(db, abandoned.id, now)?.status, "interrupted");
    assert.equal(getSwarm(db, foreign.id, now)?.status, "interrupted");
    const last = latestEventId(db);
    assert.deepEqual(
      sweepStaleRuns(
        db,
        now + 60_000,
        () => true,
        (id) => id === active.id,
      ),
      [],
    );
    assert.equal(latestEventId(db), last, "refreshing a heartbeat is not a status transition");
    assert.deepEqual(
      sweepStaleRuns(db, now + 120_000, () => true),
      [active.id],
      "no default same-pid exemption",
    );
  } finally {
    temp.cleanup();
  }
});

it("never refreshes a foreign lock even if the ownership predicate returns true", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db, { runnerPid: process.ppid });
    assert.deepEqual(
      sweepStaleRuns(
        temp.db,
        T0 + 60_000,
        () => true,
        () => true,
      ),
      [swarm.id],
    );
  } finally {
    temp.cleanup();
  }
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { beginResume, endRun } from "../../src/broker/swarms.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getPendingReplacementHandoff, seedReplacementHandoff } from "../../src/store/replacement-handoff.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

it("persists an unlaunched replacement handoff through reopen and stop/resume until genuine first idle", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  const handoff = `handoffs/${swarm.id}/original.md`;
  seedReplacementHandoff(temp.db, swarm.id, "Maria", handoff, T0);
  seedReplacementHandoff(temp.db, swarm.id, "Maria", `handoffs/${swarm.id}/other.md`, T0 + 1);
  assert.equal(
    getPendingReplacementHandoff(temp.db, swarm.id, "Maria"),
    handoff,
    "accepted handoff identity is not overwritten on replay",
  );
  assert.equal(getPendingReplacementHandoff(temp.db, swarm.id, "John"), null);
  endRun(temp.db, swarm.id, process.pid, "stopped", T0 + 2);
  beginResume(temp.db, swarm.id, process.pid, T0 + 100);
  const reopened = openSwarmDb(temp.db.path, { create: false });
  try {
    assert.equal(getPendingReplacementHandoff(reopened, swarm.id, "Maria"), handoff);
    setAgentStatus(temp.db, swarm.id, "Maria", "idle", T0 + 101);
    assert.equal(getPendingReplacementHandoff(reopened, swarm.id, "Maria"), null);
    assert.equal(
      reopened.sql
        .prepare("SELECT handoff_file FROM replacement_handoffs WHERE swarm_id = ? AND name = 'Maria'")
        .get(swarm.id)?.handoff_file,
      handoff,
      "settled mappings remain historical evidence",
    );
  } finally {
    reopened.close();
  }
});

it("isolates swarm mappings, rejects escaping paths and joins fresh-slot rollback", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const first = seedSwarm(temp.db);
  const second = seedSwarm(temp.db);
  assert.throws(
    () => seedReplacementHandoff(temp.db, first.id, "Maria", `handoffs/${second.id}/wrong-swarm.md`, T0),
    /this swarm/,
  );
  assert.throws(() => seedReplacementHandoff(temp.db, first.id, "Maria", "../secret.md", T0), /this swarm/);
  assert.throws(
    () =>
      temp.db.write(() => {
        seedReplacementHandoff(temp.db, first.id, "Maria", `handoffs/${first.id}/rollback.md`, T0);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(getPendingReplacementHandoff(temp.db, first.id, "Maria"), null);
  seedReplacementHandoff(temp.db, second.id, "Maria", `handoffs/${second.id}/valid.md`, T0);
  assert.equal(getPendingReplacementHandoff(temp.db, first.id, "Maria"), null);
  temp.db.sql
    .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'")
    .run(T0 + 1, second.id);
  assert.equal(getPendingReplacementHandoff(temp.db, second.id, "Maria"), null);
});

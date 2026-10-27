import assert from "node:assert/strict";
import { it } from "node:test";
import { openSwarmDb } from "../../src/store/db.js";
import { seedReplacementHandoff } from "../../src/store/replacement-handoff.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import type { SwarmDb } from "../../src/store/db.js";
import { getParticipant, listParticipants } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function recordConfiguration(db: SwarmDb, swarmId: number) {
  saveRunConfiguration(
    db,
    swarmId,
    1,
    {
      version: 1,
      workers: ["Maria", "John", "Liam"].map((name) => ({
        name,
        provider: "fixture",
        modelId: "worker",
        thinkingLevel: null,
      })),
      launch: { projectTrusted: false, noExtensions: false, extensionArgs: [] },
      timing: {
        staggerSeconds: 0,
        idleReminderDelay: 0,
        idleReminderDigestSize: 1,
        heartbeatMs: 1,
        deliveryPollMs: 1,
        completionCheckMs: 1,
        progressMs: 1,
        resumeStaggerMs: 0,
        reviveBackoffMs: [],
      },
      limits: { maxRpcFrameBytes: 100000 },
      budget: { moneyUsd: null, timeSeconds: null, gracefulShutdown: false },
    },
    T0,
  );
}

it("reports only durable replacement lineage through list, lookup and reopen", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  recordConfiguration(db, swarm.id);
  const other = seedSwarm(db);
  const handoff = `handoffs/${swarm.id}/replacement.md`;
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'").run(T0, swarm.id);
  const participant = getParticipant(db, swarm.id, "Maria");
  assert.equal(participant?.kind === "agent" && participant.successorName, null);
  db.sql
    .prepare(
      `INSERT INTO configuration_requests
        (swarm_id,run,expected_revision,change,requested_by,status,created_at)
        VALUES (?,1,0,?,'Maria','applying',?)`,
    )
    .run(swarm.id, JSON.stringify({ type: "retireAgent", name: "Maria", handoffFile: handoff }), T0);
  assert.equal(
    listParticipants(db, swarm.id).find((row) => row.kind === "agent" && row.name === "Maria")?.kind,
    "agent",
  );
  const beforeMapping = getParticipant(db, swarm.id, "Maria");
  assert.equal(beforeMapping?.kind === "agent" && beforeMapping.successorName, null, "intent alone is not lineage");
  seedReplacementHandoff(db, swarm.id, "John", handoff, T0);
  const retired = getParticipant(db, swarm.id, "MARIA");
  assert.equal(retired?.kind === "agent" && retired.successorName, "John");
  const listed = listParticipants(db, swarm.id).find((row) => row.name === "Maria");
  assert.equal(listed?.kind === "agent" && listed.successorName, "John");
  const active = getParticipant(db, swarm.id, "John");
  assert.equal(active?.kind === "agent" && active.successorName, null);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'John'").run(T0 + 1, swarm.id);
  const reopened = openSwarmDb(db.path, { create: false });
  try {
    const historical = getParticipant(reopened, swarm.id, "Maria");
    assert.equal(historical?.kind === "agent" && historical.successorName, "John", "lineage remains historical");
    const unrelated = getParticipant(reopened, other.id, "Maria");
    assert.equal(unrelated?.kind === "agent" && unrelated.successorName, null);
  } finally {
    reopened.close();
  }
});

it("does not infer successors from removal, worker order or unmatched handoffs", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  recordConfiguration(db, swarm.id);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'").run(T0, swarm.id);
  db.sql
    .prepare(
      `INSERT INTO configuration_requests
        (swarm_id,run,expected_revision,change,requested_by,status,created_at)
        VALUES (?,1,0,?,'User','applied',?)`,
    )
    .run(swarm.id, JSON.stringify({ type: "removeAgent", name: "Maria" }), T0);
  seedReplacementHandoff(db, swarm.id, "Liam", `handoffs/${swarm.id}/unrelated.md`, T0);
  const retired = getParticipant(db, swarm.id, "Maria");
  assert.equal(retired?.kind === "agent" && retired.successorName, null);
});

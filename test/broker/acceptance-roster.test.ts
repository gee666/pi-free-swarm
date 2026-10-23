import assert from "node:assert/strict";
import { test } from "node:test";
import { readAcceptanceHistory } from "../../src/broker/acceptance-history.js";
import {
  inspectAcceptance,
  invalidateAgentVote,
  mutateAcceptance,
  recordRosterAcceptanceChange,
  resetAcceptanceVotes,
  sealAcceptance,
} from "../../src/broker/acceptance.js";
import { openSwarmDb, type SwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function vote(db: SwarmDb, swarmId: number, name: string, verdict: "accepted" | "blocked") {
  return mutateAcceptance(db, swarmId, name, { action: "vote", verdict, reason: `${name} original evidence` }, T0);
}

function retire(db: SwarmDb, swarmId: number, name: string) {
  return db.write(() => {
    db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?").run(T0 + 1, swarmId, name);
    return recordRosterAcceptanceChange(db, swarmId, T0 + 1);
  });
}

test("explicit retirement removes both its vote and its denominator share without deleting history", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    vote(db, swarm.id, "Maria", "accepted");
    vote(db, swarm.id, "John", "accepted");
    const before = vote(db, swarm.id, "Liam", "blocked");
    assert.equal(before.threshold, 3);
    const after = retire(db, swarm.id, "Maria");
    assert.equal(after.totalAgents, 2);
    assert.equal(after.threshold, 2);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.updatedBy, "User");
    assert.deepEqual(after.counts, { accepted: 1, incomplete: 0, blocked: 1 });
    assert.equal(after.verdict, "incomplete", "a retired accepted vote cannot count toward the smaller quorum");
    assert.deepEqual(
      after.votes.map((entry) => entry.agent),
      ["John", "Liam"],
    );
    assert.equal(after.excludedVotes, undefined, "hot roster responses do not copy history");
    const history = readAcceptanceHistory(db, swarm.id);
    assert.deepEqual(
      history.votes.map((entry) => entry.agent),
      ["Maria"],
    );
    assert.equal(history.votes[0]?.reason, "Maria original evidence");
    assert.equal(
      db.sql.prepare("SELECT reason FROM acceptance_votes WHERE swarm_id = ? AND agent = 'Maria'").get(swarm.id)
        ?.reason,
      "Maria original evidence",
    );
    const final = retire(db, swarm.id, "Liam");
    assert.equal(final.totalAgents, 1);
    assert.equal(final.threshold, 1);
    assert.equal(final.verdict, "accepted");
  } finally {
    temp.cleanup();
  }
});

test("the active electorate keeps ordinary rounded-up seventy percent after removal and addition", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const names = Array.from({ length: 15 }, (_, index) => `Worker${index}`);
    const swarm = seedSwarm(db, { agents: names });
    assert.equal(inspectAcceptance(db, swarm.id).threshold, 11);
    for (const name of names.slice(0, 4)) retire(db, swarm.id, name);
    const removed = inspectAcceptance(db, swarm.id);
    assert.equal(removed.totalAgents, 11);
    assert.equal(removed.threshold, 8);
    db.sql.prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND name = 'Worker4'").run(swarm.id);
    assert.equal(inspectAcceptance(db, swarm.id).totalAgents, 11, "a crash alone does not remove a voter");
    db.write(() => {
      db.sql
        .prepare(
          "INSERT INTO participants (swarm_id, name, kind, status, launch_order) VALUES (?, 'Added', 'agent', 'pending', 100)",
        )
        .run(swarm.id);
      recordRosterAcceptanceChange(db, swarm.id, T0 + 2);
    });
    const added = inspectAcceptance(db, swarm.id);
    assert.equal(added.totalAgents, 12);
    assert.equal(added.threshold, 9);
    assert.equal(added.votes.length, 0);
    assert.equal(added.verdict, "unchecked");
  } finally {
    temp.cleanup();
  }
});

test("atomic fresh-worker replacement keeps the denominator but does not transfer its predecessor's judgment", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    for (const name of ["Maria", "John", "Liam"]) vote(db, swarm.id, name, "accepted");
    const before = inspectAcceptance(db, swarm.id);
    assert.equal(before.verdict, "accepted");
    const after = db.write(() => {
      db.sql
        .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'")
        .run(T0 + 1, swarm.id);
      db.sql
        .prepare(
          "INSERT INTO participants (swarm_id, name, kind, status, launch_order) VALUES (?, 'Fresh', 'agent', 'pending', 100)",
        )
        .run(swarm.id);
      return recordRosterAcceptanceChange(db, swarm.id, T0 + 1, "Maria");
    });
    assert.equal(after.totalAgents, 3);
    assert.equal(after.threshold, 3);
    assert.equal(after.counts.accepted, 2);
    assert.equal(after.verdict, "incomplete");
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.updatedBy, "Maria");
    assert.ok(!after.votes.some((entry) => entry.agent === "Fresh"));
    assert.equal(
      db.sql.prepare("SELECT verdict FROM acceptance_votes WHERE swarm_id = ? AND agent = 'Maria'").get(swarm.id)
        ?.verdict,
      "accepted",
    );
  } finally {
    temp.cleanup();
  }
});

test("retired workers cannot vote late and crash invalidation or resume reset cannot erase their historical vote", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    vote(db, swarm.id, "Maria", "accepted");
    vote(db, swarm.id, "John", "blocked");
    const before = retire(db, swarm.id, "Maria");
    const historical = db.sql
      .prepare("SELECT * FROM acceptance_votes WHERE swarm_id = ? AND agent = 'Maria'")
      .get(swarm.id);
    assert.throws(() => vote(db, swarm.id, "Maria", "blocked"), /Removed workers cannot vote/);
    assert.equal(inspectAcceptance(db, swarm.id).revision, before.revision);
    assert.equal(invalidateAgentVote(db, swarm.id, 1, "Maria", "Late retired process exit", T0 + 3), false);
    resetAcceptanceVotes(db, swarm.id, T0 + 4);
    assert.deepEqual(
      db.sql.prepare("SELECT * FROM acceptance_votes WHERE swarm_id = ? AND agent = 'Maria'").get(swarm.id),
      historical,
    );
    assert.equal(inspectAcceptance(db, swarm.id).votes.length, 0);
    assert.equal(readAcceptanceHistory(db, swarm.id).votes[0]?.reason, "Maria original evidence");
    db.sql.prepare("UPDATE swarms SET run_count = 2 WHERE id = ?").run(swarm.id);
    assert.equal(readAcceptanceHistory(db, swarm.id).votes[0]?.run, 1);
    assert.equal(
      db.sql.prepare("SELECT COUNT(*) AS n FROM acceptance_votes WHERE swarm_id = ? AND agent = 'John'").get(swarm.id)
        ?.n,
      0,
    );
  } finally {
    temp.cleanup();
  }
});

test("a concurrent roster edit invalidates a stale vote revision without changing its judgment", () => {
  const temp = createTempDb();
  const other = openSwarmDb(temp.db.path, { create: false });
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const before = vote(db, swarm.id, "John", "accepted");
    const after = retire(other, swarm.id, "Maria");
    assert.throws(
      () =>
        mutateAcceptance(
          db,
          swarm.id,
          "John",
          {
            action: "vote",
            verdict: "blocked",
            reason: "stale response",
            revision: before.revision,
          },
          T0 + 2,
        ),
      /Stale acceptance revision/,
    );
    const current = inspectAcceptance(db, swarm.id);
    assert.equal(current.revision, after.revision);
    assert.equal(current.totalAgents, 2);
    assert.equal(current.votes[0]?.verdict, "accepted");
  } finally {
    other.close();
    temp.cleanup();
  }
});

test("a retirement racing sealed admission rolls back membership and outbox changes together", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const before = inspectAcceptance(db, swarm.id);
    sealAcceptance(db, swarm.id, 1, before.revision);
    const events = db.sql.prepare("SELECT * FROM events").all();
    assert.throws(() => retire(db, swarm.id, "Maria"), /admission is closed/);
    assert.equal(
      db.sql.prepare("SELECT retired_at FROM participants WHERE swarm_id = ? AND name = 'Maria'").get(swarm.id)
        ?.retired_at,
      null,
    );
    assert.deepEqual(db.sql.prepare("SELECT * FROM events").all(), events);
    assert.equal(inspectAcceptance(db, swarm.id).totalAgents, 3);
    assert.equal(inspectAcceptance(db, swarm.id).revision, before.revision);
  } finally {
    temp.cleanup();
  }
});

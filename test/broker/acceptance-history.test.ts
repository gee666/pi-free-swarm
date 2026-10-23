import assert from "node:assert/strict";
import { test } from "node:test";
import { readAcceptanceHistory } from "../../src/broker/acceptance-history.js";
import { inspectAcceptance } from "../../src/broker/acceptance.js";
import { closeRunAdmission } from "../../src/broker/run-acceptance.js";
import { PAGE_MAX_COUNT, WATCHER_NAME } from "../../src/constants.js";
import type { SwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function archive(db: SwarmDb, swarmId: number, name: string, retiredAt: number, reason?: string) {
  db.sql
    .prepare(
      `INSERT INTO participants (swarm_id, name, kind, status, retired_at)
    VALUES (?, ?, 'agent', 'stopped', ?)`,
    )
    .run(swarmId, name, retiredAt);
  if (reason !== undefined)
    db.sql
      .prepare(
        `INSERT INTO acceptance_votes
    (swarm_id, agent, run, verdict, reason, updated_at) VALUES (?, ?, 1, 'accepted', ?, ?)`,
      )
      .run(swarmId, name, reason, T0);
}

test("hot acceptance reads remain indexed and active-only under retirement churn", (t) => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    db.write(() => {
      for (let index = 0; index < 1000; index++)
        archive(db, swarm.id, `Archived${index}`, T0 + index, `Evidence ${index}: ${"x".repeat(1000)}`);
    });
    const original = db.sql.prepare.bind(db.sql);
    let hotSql = "";
    let historySql = "";
    db.sql.prepare = (sql) => {
      if (sql.includes("AS total_agents")) hotSql = sql;
      if (sql.includes("AS retired_name")) historySql = sql;
      return original(sql);
    };
    const hot = inspectAcceptance(db, swarm.id);
    assert.equal(hot.totalAgents, 3);
    assert.equal(hot.excludedVotes, undefined);
    assert.ok(JSON.stringify(hot).length < 1000);
    assert.ok(hotSql);
    const hotPlan = original(`EXPLAIN QUERY PLAN ${hotSql}`)
      .all(WATCHER_NAME, WATCHER_NAME, swarm.id)
      .map((row) => String(row.detail))
      .join("\n");
    assert.match(hotPlan, /SEARCH p USING (?:COVERING )?INDEX participants_active_roster/);
    assert.match(hotPlan, /SEARCH participants USING (?:COVERING )?INDEX participants_active_roster/);
    const page = readAcceptanceHistory(db, swarm.id, { count: 20 });
    assert.equal(page.scanned, 20);
    assert.equal(page.votes.length, 20);
    assert.equal(page.complete, false);
    assert.ok(page.next);
    assert.ok(historySql);
    const historyPlan = original(`EXPLAIN QUERY PLAN ${historySql}`)
      .all(swarm.id, WATCHER_NAME, 21)
      .map((row) => String(row.detail))
      .join("\n");
    assert.match(historyPlan, /SEARCH p USING (?:COVERING )?INDEX participants_retired_history/);
    assert.doesNotMatch(historySql, /OFFSET/);
    t.diagnostic(`Hot plan:\n${hotPlan}\nHistory plan:\n${historyPlan}`);
    const final = closeRunAdmission(db, { swarmId: swarm.id, run: 1, runnerPid: process.pid, now: T0 + 2000 });
    assert.equal(final?.excludedVotes?.length, 1000, "a final Main snapshot deliberately retains all archived reasons");
  } finally {
    temp.cleanup();
  }
});

test("empty-vote pages advance raw retired rows without an unbounded historical hunt", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    db.write(() => {
      archive(db, swarm.id, "Old", T0, "Full original Unicode evidence: 中文 😀\nsecond line");
      for (let index = 1; index <= 10; index++) archive(db, swarm.id, `Silent${index}`, T0 + index);
    });
    let page = readAcceptanceHistory(db, swarm.id, { count: 3 });
    assert.equal(page.votes.length, 0);
    assert.equal(page.scanned, 3);
    assert.equal(page.complete, false);
    let scanned = page.scanned;
    const votes = [...page.votes];
    while (page.next) {
      page = readAcceptanceHistory(db, swarm.id, { count: 3, after: page.next });
      assert.ok(page.scanned <= 3);
      scanned += page.scanned;
      votes.push(...page.votes);
    }
    assert.equal(page.complete, true);
    assert.equal(scanned, 11);
    assert.equal(votes.length, 1);
    assert.equal(votes[0]?.reason, "Full original Unicode evidence: 中文 😀\nsecond line");
    assert.equal(inspectAcceptance(db, swarm.id).counts.accepted, 0);
  } finally {
    temp.cleanup();
  }
});

test("keyset history is swarm-isolated and fresh first pages expose concurrent new retirements", () => {
  const temp = createTempDb();
  try {
    const { db } = temp;
    const swarm = seedSwarm(db);
    const other = seedSwarm(db);
    for (const name of ["Alpha", "Beta", "Gamma"]) archive(db, swarm.id, name, T0, name);
    const first = readAcceptanceHistory(db, swarm.id, { count: 1 });
    assert.equal(first.votes[0]?.agent, "Gamma");
    assert.ok(first.next);
    assert.throws(() => readAcceptanceHistory(db, other.id, { after: first.next ?? undefined }), /for this swarm/);
    archive(db, swarm.id, "Newest", T0 + 1, "new evidence");
    const older = readAcceptanceHistory(db, swarm.id, { count: 2, after: first.next });
    assert.deepEqual(
      older.votes.map((vote) => vote.agent),
      ["Beta", "Alpha"],
    );
    assert.equal(older.complete, true);
    assert.equal(readAcceptanceHistory(db, swarm.id, { count: 1 }).votes[0]?.agent, "Newest");
    assert.deepEqual(readAcceptanceHistory(db, other.id), { votes: [], scanned: 0, complete: true, next: null });
  } finally {
    temp.cleanup();
  }
});

test("history count and cursor errors are bounded field-specific repairs", () => {
  const temp = createTempDb();
  try {
    const swarm = seedSwarm(temp.db);
    for (const count of [0, -1, 1.5, PAGE_MAX_COUNT + 1, Number.NaN]) {
      assert.throws(() => readAcceptanceHistory(temp.db, swarm.id, { count }), /count must be between/);
    }
    for (const after of ["", "secret-private-input", Buffer.from('[1,1,-1,"name"]').toString("base64url")]) {
      assert.throws(
        () => readAcceptanceHistory(temp.db, swarm.id, { after }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /after must be a returned history cursor/);
          assert.equal(error.message.includes("secret-private-input"), false);
          return true;
        },
      );
    }
  } finally {
    temp.cleanup();
  }
});

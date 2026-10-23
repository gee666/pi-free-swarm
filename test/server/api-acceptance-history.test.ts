import assert from "node:assert/strict";
import { test } from "node:test";
import type { SwarmDetailResponse } from "../../src/api-types.js";
import type { AcceptanceHistoryPage } from "../../src/store/acceptance-types.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

test("retired judgments are deliberate bounded HTTP history, absent from hot snapshots and isolated by swarm", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const now = Date.now();
  const swarm = seedSwarm(board.temp.db, { now });
  const other = seedSwarm(board.temp.db, { now });
  for (const name of ["Maria", "John"]) {
    mutateAcceptance(
      board.temp.db,
      swarm.id,
      name,
      { action: "vote", verdict: "blocked", reason: `Archived reason from ${name}` },
      now,
    );
    board.temp.db.sql
      .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?")
      .run(now, swarm.id, name);
  }
  const detail = await getJson<SwarmDetailResponse>(`${board.base}/api/swarms/${swarm.id}`);
  assert.equal(JSON.stringify(detail.body.acceptance).includes("Archived reason"), false);
  const url = `${board.base}/api/swarms/${swarm.id}/acceptance/history`;
  const first = await getJson<AcceptanceHistoryPage>(`${url}?count=1`);
  assert.equal(first.status, 200);
  assert.equal(first.body.scanned, 1);
  assert.equal(first.body.votes.length, 1);
  assert.equal(first.body.complete, false);
  assert.ok(first.body.next);
  const second = await getJson<AcceptanceHistoryPage>(`${url}?count=1&after=${encodeURIComponent(first.body.next)}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.scanned, 1);
  assert.equal(second.body.complete, true);
  assert.equal(second.body.next, null);
  assert.deepEqual(
    new Set([...first.body.votes, ...second.body.votes].map((vote) => vote.agent)),
    new Set(["Maria", "John"]),
  );
  const cross = await getJson(
    `${board.base}/api/swarms/${other.id}/acceptance/history?after=${encodeURIComponent(first.body.next)}`,
  );
  assert.equal(cross.status, 400);
  for (const query of ["count=0", "count=101", "after=", "after=not-a-cursor", "offset=1"]) {
    assert.equal((await getJson(`${url}?${query}`)).status, 400, query);
  }
  const empty = await getJson<AcceptanceHistoryPage>(`${board.base}/api/swarms/${other.id}/acceptance/history`);
  assert.deepEqual(empty.body, { votes: [], next: null, complete: true, scanned: 0 });
  assert.equal((await getJson(`${board.base}/api/swarms/999999/acceptance/history`)).status, 404);
});

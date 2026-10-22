import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import type { SwarmDetailResponse } from "../../src/api-types.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { eventTypes, seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

it("projects votes, quorum and reasons independently from execution and reads the configured body allowance", async () => {
  const board = await startTestBoard();
  try {
    const { db, cwd } = board.temp;
    const swarm = seedSwarm(db, { now: Date.now() });
    const url = `${board.base}/api/swarms/${swarm.id}`;
    const initialResponse = await getJson<SwarmDetailResponse>(url);
    assert.equal(initialResponse.status, 200);
    const initial = initialResponse.body;
    assert.equal(initial.bodyMaxChars, 200);
    assert.equal(initial.acceptance.verdict, "unchecked");
    assert.equal(initial.acceptance.totalAgents, 3);
    assert.equal(initial.acceptance.threshold, 3);
    assert.deepEqual(initial.acceptance.votes, []);
    assert.deepEqual(initial.acceptance.acceptanceCriteria, swarm.acceptanceCriteria);
    assert.deepEqual(initial.swarm.acceptanceCriteria, swarm.acceptanceCriteria);
    writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), JSON.stringify({ bodyMaxChars: 8000 }));
    const vote = (agent: string, verdict: "accepted" | "incomplete" | "blocked", reason: string) =>
      mutateAcceptance(db, swarm.id, agent, { action: "vote", verdict, reason }, Date.now());
    vote("Maria", "incomplete", "Browser check missing.");
    vote("John", "accepted", "Tests pass.");
    vote("Maria", "accepted", "Browser check now passes.");
    const pending = (await getJson<SwarmDetailResponse>(url)).body;
    assert.equal(pending.acceptance.verdict, "incomplete");
    assert.equal(pending.acceptance.votes.length, 2);
    assert.deepEqual(pending.acceptance.counts, { accepted: 2, incomplete: 0, blocked: 0 });
    vote("Liam", "accepted", "All requirements checked.");
    const result = (await getJson<SwarmDetailResponse>(url)).body;
    assert.equal(result.bodyMaxChars, 8000);
    assert.equal(result.swarm.status, "starting");
    assert.equal(result.acceptance.verdict, "accepted");
    assert.deepEqual(result.acceptance.counts, { accepted: 3, incomplete: 0, blocked: 0 });
    assert.equal(result.acceptance.votes.find((entry) => entry.agent === "Maria")?.reason, "Browser check now passes.");
    assert.deepEqual(
      result.participants.map((participant) => participant.name),
      ["User", "Maria", "John", "Liam", "Watcher"],
    );
    assert.equal(eventTypes(db).filter((type) => type === "acceptance.updated").length, 4);
  } finally {
    await board.close();
  }
});

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import type { SwarmDetailResponse } from "../../src/api-types.js";
import { mutateAcceptance } from "../../src/broker/acceptance.js";
import { eventTypes, seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

it("projects acceptance independently from execution and reads the configured body allowance", async () => {
  const board = await startTestBoard();
  try {
    const { db, cwd } = board.temp;
    const swarm = seedSwarm(db, { now: Date.now() });
    const url = `${board.base}/api/swarms/${swarm.id}`;
    const initial = (await getJson<SwarmDetailResponse>(url)).body;
    assert.equal(initial.bodyMaxChars, 200);
    assert.equal(initial.acceptance.verdict, "unchecked");
    writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), JSON.stringify({ bodyMaxChars: 8000 }));
    mutateAcceptance(db, swarm.id, "Maria", { action: "claim", revision: 0 }, Date.now());
    const payload = { evidence: [{ reference: "report", result: "passed" }], knownGaps: [], findings: [] };
    mutateAcceptance(
      db,
      swarm.id,
      "Maria",
      { action: "update", revision: 1, verdict: "accepted", payload },
      Date.now(),
    );
    const result = (await getJson<SwarmDetailResponse>(url)).body;
    assert.equal(result.bodyMaxChars, 8000);
    assert.equal(result.swarm.status, "starting");
    assert.equal(result.acceptance.verdict, "accepted");
    assert.deepEqual(result.acceptance.evidence, payload.evidence);
    assert.equal(eventTypes(db).filter((type) => type === "acceptance.updated").length, 2);
  } finally {
    await board.close();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunResultText } from "../../src/tools/result.js";
import { workFixture } from "../helpers/work-graph.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { T0 } from "../helpers/temp-db.js";

test("status document lists all gates, outcome and board without whole-task tally", (t) => {
  const f = workFixture(t);
  f.settle();
  const swarm = getSwarm(f.db, f.swarmId, T0);
  assert.ok(swarm);
  const text = buildRunResultText(
    f.db,
    { swarm, run: 1, end: "finished", outcome: "completed" },
    "http://localhost:3010",
    T0,
  );
  assert.match(text, /Outcome: completed/);
  for (const gate of ["linked", "tasks", "criteria", "review"]) assert.ok(text.includes(`OK ${gate}`));
  assert.doesNotMatch(text, /awaits User|approve.*scope/);
  assert.doesNotMatch(text, /quorum|Threshold:|Tally:|Task verdict:/);
});

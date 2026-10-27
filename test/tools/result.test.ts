import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitingUserText, buildRunResultText } from "../../src/tools/result.js";
import { approveScope } from "../../src/broker/project.js";
import { workFixture } from "../helpers/work-graph.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { T0 } from "../helpers/temp-db.js";

test("status document lists all gates, outcome and board without whole-task tally", (t) => {
  const f = workFixture(t);
  f.settle();
  const waiting = awaitingUserText(f.db, f.swarmId, "http://localhost:3010");
  for (const text of [
    "awaits User",
    "scope",
    "linked",
    "tasks",
    "criteria",
    "review",
    "Board:",
    "approve the current scope",
    "decide pending blockers",
    "never",
  ]) {
    if (text !== "never") assert.ok(waiting.includes(text), text);
  }
  assert.match(waiting, /Do not approve/);
  approveScope(f.db, f.input("User"));
  const swarm = getSwarm(f.db, f.swarmId, T0);
  assert.ok(swarm);
  const text = buildRunResultText(
    f.db,
    { swarm, run: 1, end: "finished", outcome: "completed" },
    "http://localhost:3010",
    T0,
  );
  assert.match(text, /Outcome: completed/);
  assert.doesNotMatch(text, /quorum|Threshold:|Tally:|Task verdict:/);
});

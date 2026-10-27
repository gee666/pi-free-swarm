import assert from "node:assert/strict";
import { test } from "node:test";
import { boundRunResult } from "../../src/tools/result.js";
import { readRunProgress } from "../../src/broker/run-progress.js";
import { workFixture } from "../helpers/work-graph.js";
import { T0 } from "../helpers/temp-db.js";

test("large main output is bounded without losing the renderer progress snapshot", async (t) => {
  const f = workFixture(t);
  const details = readRunProgress(f.db, f.swarmId, T0, null);
  const result = await boundRunResult({ content: [{ type: "text", text: "Evidence ".repeat(100_000) }], details });
  assert.equal(result.details.swarmId, f.swarmId);
  assert.ok(result.details.fullOutputPath);
  assert.ok(result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("").length < 100_000);
});

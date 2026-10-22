import assert from "node:assert/strict";
import { it } from "node:test";
import { reviveDelayMs } from "../../src/broker/lifecycle.js";
import { REVIVE_BACKOFF_MS } from "../../src/constants.js";

it("follows revive backoff and returns null once the budget is used", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((used) => reviveDelayMs(used)),
    [...REVIVE_BACKOFF_MS, null],
  );
  assert.equal(reviveDelayMs(1, [5, 7]), 7);
  assert.equal(reviveDelayMs(2, [5, 7]), null);
});

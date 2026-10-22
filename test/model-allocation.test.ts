import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateModelCounts,
  parseModelProfiles,
  resolveModelAssignments,
  type ModelProfile,
} from "../src/model-allocation.js";

const inherited = { provider: "parent", modelId: "main", thinkingLevel: "high" };
const profile = (weight?: number): ModelProfile => ({
  provider: "configured",
  model: "worker",
  thinkingLevel: "low",
  ...(weight === undefined ? {} : { count_proportional: weight }),
});
const available = [{ provider: "configured", id: "worker", thinkingLevels: ["off", "low"] }];

describe("static model allocation", () => {
  it("inherits Main provider, model and thinking without changing count", () => {
    const workers = resolveModelAssignments(15, undefined, inherited, []);
    assert.equal(workers.length, 15);
    assert.deepEqual(workers[0], inherited);
    assert.notEqual(workers[0], inherited);
  });

  it("allocates omitted weights as one relative part", () => {
    assert.deepEqual(allocateModelCounts(10, [profile(5), profile(3), profile(), profile()]), [5, 3, 1, 1]);
    assert.deepEqual(allocateModelCounts(5, [profile(), profile(), profile()]), [2, 2, 1]);
  });

  it("uses largest remainder and configuration-order ties for tiny and uneven swarms", () => {
    assert.deepEqual(allocateModelCounts(1, [profile(), profile(), profile()]), [1, 0, 0]);
    assert.deepEqual(allocateModelCounts(7, [profile(5), profile(3), profile(1)]), [4, 2, 1]);
    assert.deepEqual(allocateModelCounts(15, [profile(3), profile(2)]), [9, 6]);
    assert.deepEqual(
      allocateModelCounts(3, [profile(Number.MAX_SAFE_INTEGER), profile(Number.MAX_SAFE_INTEGER)]),
      [2, 1],
    );
  });

  it("resolves explicit catalog identities and supported thinking without fallback", () => {
    const workers = resolveModelAssignments(4, [profile()], inherited, available);
    assert.equal(workers.length, 4);
    assert.deepEqual(workers[0], { provider: "configured", modelId: "worker", thinkingLevel: "low" });
    assert.throws(() => resolveModelAssignments(2, [profile()], inherited, []), /models\[0\].*unavailable/);
    assert.throws(
      () => resolveModelAssignments(2, [{ ...profile(), thinkingLevel: "high" }], inherited, available),
      /thinkingLevel.*unsupported/,
    );
    assert.throws(() => resolveModelAssignments(2, undefined, null, []), /Select a Main model/);
  });

  it("validates every supplied profile including zero-slot profiles", () => {
    assert.throws(
      () => resolveModelAssignments(1, [profile(), { ...profile(), model: "missing" }], inherited, available),
      /models\[1\].*unavailable/,
    );
    for (const value of [
      [],
      null,
      {},
      [{ ...profile(), provider: "" }],
      [{ ...profile(), thinkingLevel: "extreme" }],
    ]) {
      assert.throws(() => parseModelProfiles(value), /models/);
    }
    for (const value of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => parseModelProfiles([{ ...profile(), count_proportional: value }]), /count_proportional/);
    }
    assert.deepEqual(parseModelProfiles([profile()]), [profile()]);
  });

  it("preserves exact requested totals across a range of counts and weights", () => {
    for (let count = 1; count <= 30; count++) {
      const counts = allocateModelCounts(count, [profile(7), profile(), profile(3), profile(2)]);
      assert.equal(
        counts.reduce((sum, value) => sum + value, 0),
        count,
      );
      assert.ok(counts.every((value) => Number.isInteger(value) && value >= 0));
    }
  });
});

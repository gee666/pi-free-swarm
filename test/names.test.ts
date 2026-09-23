import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_NAMES, pickAgentNames } from "../src/names.js";

describe("names", () => {
  it("has a large pool without reserved or duplicate names", () => {
    const lower = AGENT_NAMES.map((name) => name.toLowerCase());
    assert.ok(AGENT_NAMES.length >= 900);
    assert.equal(new Set(lower).size, lower.length);
    for (const reserved of ["user", "main", "system"]) assert.ok(!lower.includes(reserved));
    assert.ok(AGENT_NAMES.every((name) => /^[A-Za-z]+$/.test(name)));
  });

  it("picks distinct names", () => {
    const names = pickAgentNames(50);
    assert.equal(names.length, 50);
    assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 50);
    assert.ok(names.every((name) => AGENT_NAMES.includes(name)));
  });

  it("is driven by the random source", () => {
    assert.deepEqual(
      pickAgentNames(3, () => 0),
      AGENT_NAMES.slice(0, 3),
    );
    assert.deepEqual(
      pickAgentNames(3, () => 0.5),
      pickAgentNames(3, () => 0.5),
    );
    assert.equal(pickAgentNames(AGENT_NAMES.length).length, AGENT_NAMES.length);
  });

  it("refuses more names than the pool has", () => {
    assert.throws(() => pickAgentNames(AGENT_NAMES.length + 1), /Cannot pick/);
    assert.throws(() => pickAgentNames(-1), /Cannot pick/);
  });
});

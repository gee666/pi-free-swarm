import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lateCount, LateReserve } from "../../src/broker/late-peers.js";
import type { AgentLiveness } from "../../src/broker/lifecycle.js";

class FakePeer {
  readonly name: string;
  status: AgentLiveness["status"] = "pending";
  exhausted = false;

  constructor(name: string) {
    this.name = name;
  }

  liveness(): AgentLiveness {
    return { status: this.status, reviveScheduled: false, revivesExhausted: this.exhausted };
  }
}

function reserve(agentCount: number, ratio: number, run = 1) {
  const peers = Array.from({ length: agentCount }, (_, index) => new FakePeer(`P${index + 1}`));
  const late = new LateReserve(peers, ratio, run);
  const launched: string[] = [];
  const release = (runQuiet = false) => late.release(runQuiet, (peer) => launched.push(peer.name));
  const settle = (...names: string[]) => {
    for (const peer of peers) if (names.includes(peer.name)) peer.status = "idle";
  };
  return { peers, late, launched, release, settle };
}

describe("late peer count", () => {
  it("rounds the ratio, keeps at least one late peer from two agents and one early agent", () => {
    const cases: [number, number, number][] = [
      [4, 0.2, 1],
      [10, 0.2, 2],
      [2, 0.2, 1],
      [8, 0.2, 2],
      [3, 0.5, 2],
      [10, 0.5, 5],
      [1, 0.5, 0],
      [5, 0, 0],
    ];
    for (const [agents, ratio, expected] of cases)
      assert.equal(lateCount(agents, ratio, 1), expected, `${agents}×${ratio}`);
    assert.equal(lateCount(10, 0.2, 2), 0, "resume has no reserve");
  });
});

describe("late peer release", () => {
  it("holds the last agents in launch order", () => {
    const { late } = reserve(10, 0.2);
    assert.deepEqual(
      ["P8", "P9", "P10"].map((name) => late.holds(name)),
      [false, true, true],
    );
  });

  it("releases the first of 8+2 after 4 early peers settle and the final reserve only at quiescence", () => {
    const { late, launched, release, settle } = reserve(10, 0.2);
    settle("P1", "P2", "P3");
    assert.equal(release(), false);
    settle("P4");
    assert.equal(release(), true);
    assert.deepEqual(launched, ["P9"]);
    assert.equal(late.holds("P9"), false);
    settle("P5", "P6", "P7", "P8");
    assert.equal(release(), false, "the final reserve waits for full quiescence");
    assert.equal(release(true), true);
    assert.deepEqual(launched, ["P9", "P10"]);
    assert.equal(release(true), false, "nobody is left");
  });

  it("releases every rolling peer whose threshold is met, counting exhausted crashes as settled", () => {
    const { peers, launched, release, settle } = reserve(10, 0.5);
    settle("P1");
    const crashed = peers[1];
    assert.ok(crashed);
    crashed.status = "crashed";
    crashed.exhausted = true;
    release();
    assert.deepEqual(launched, ["P6", "P7"], "thresholds 1 and 2 of 5 early peers");
    settle("P3", "P4", "P5");
    release();
    assert.deepEqual(launched, ["P6", "P7", "P8", "P9"]);
  });

  it("at a quiet point joins held rolling peers first, the final reserve at the next one", () => {
    const { launched, release } = reserve(10, 0.2);
    assert.equal(release(true), true);
    assert.deepEqual(launched, ["P9"]);
    assert.equal(release(true), true);
    assert.deepEqual(launched, ["P9", "P10"]);
  });

  it("with no late peers never releases anyone", () => {
    for (const [agents, ratio, run] of [
      [1, 0.2, 1],
      [4, 0, 1],
      [4, 0.2, 2],
    ] as const) {
      const { launched, release, settle } = reserve(agents, ratio, run);
      settle("P1", "P2", "P3", "P4");
      assert.equal(release(), false);
      assert.equal(release(true), false);
      assert.deepEqual(launched, []);
    }
  });
});

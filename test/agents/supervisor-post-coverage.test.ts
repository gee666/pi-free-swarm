import assert from "node:assert/strict";
import { test } from "node:test";
import { PostObservation } from "../../src/agents/post-observation.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { prompt, superviseFake } from "./supervisor-helpers.js";

test("rejected payloads and partial text cannot cover posts; combined full payloads can", () => {
  const coverage = new PostObservation();
  coverage.sent("complete first body", [1]);
  coverage.sent("complete second body", [2]);
  assert.deepEqual(coverage.observed("first body"), []);
  coverage.rejected("complete first body");
  assert.deepEqual(coverage.observed("complete first body"), []);
  assert.deepEqual(coverage.observed("prefix\ncomplete second body\nsuffix"), [2]);
  assert.deepEqual(coverage.observed("complete second body"), []);
});

test("full post coverage waits for real child context observation, not steering acceptance", async () => {
  const agent = superviseFake(SCENARIOS.steer);
  try {
    await agent.supervisor.launch(agent.fake.spec(), prompt("go"));
    await agent.waitStatus("working");
    const outcome = await agent.supervisor.deliver({
      text: "[swarm post #41] John: Evidence\nComplete body.",
      messageIds: [],
      postIds: [41],
    });
    assert.deepEqual(outcome, { accepted: true });
    assert.deepEqual(agent.recorded.postReads, []);
    await agent.waitStatus("idle");
    assert.deepEqual(agent.recorded.postReads, [[41]]);
  } finally {
    await agent.cleanup();
  }
});

test("post observation before acknowledgment is retained, and marker-like body text grants no coverage", async () => {
  const agent = superviseFake({ ...SCENARIOS.settle, batchRunOutput: true });
  try {
    await agent.supervisor.launch(agent.fake.spec(), prompt("go"));
    await agent.waitStatus("idle");
    assert.deepEqual(
      await agent.supervisor.deliver({
        text: "[swarm post #7] John: Quote\nA quote mentions [swarm post #999], not a returned post.",
        messageIds: [],
        postIds: [7],
      }),
      { accepted: true },
    );
    assert.deepEqual(agent.recorded.postReads, [[7]]);
    assert.deepEqual(agent.recorded.postReads, [[7]]);
  } finally {
    await agent.cleanup();
  }
});

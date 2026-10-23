import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageObservation } from "../../src/agents/message-observation.js";
import { PostObservation } from "../../src/agents/post-observation.js";

test("settled turns discard unmatched post payloads instead of retaining a lifetime transcript", () => {
  const posts = new PostObservation();
  for (let turn = 1; turn <= 50; turn++) {
    const payload = `Turn ${turn}: ${"界".repeat(5_000)}`;
    posts.sent(payload, [turn]);
    posts.settled();
    assert.deepEqual(posts.observed(payload), [], "a late uncertain observation cannot advance coverage");
  }
  posts.sent("Current replay of still-uncovered content", [51]);
  assert.deepEqual(posts.observed("Current replay of still-uncovered content"), [51]);
  assert.deepEqual(posts.observed("Current replay of still-uncovered content"), []);
});

test("settlement clears pending message authorization and historical observed IDs without dropping durable work", () => {
  const messages = new MessageObservation();
  messages.sent([1, 2]);
  assert.deepEqual(messages.observed("[swarm message #1] observed first"), [1]);
  assert.deepEqual(messages.observed("[swarm message #1] duplicate"), []);
  messages.settled();
  assert.deepEqual(messages.observed("[swarm message #2] late queued text"), []);
  messages.sent([2]);
  assert.deepEqual(messages.observed("[swarm message #2] current recovery"), [2]);
  messages.settled();
  messages.settled();
  assert.deepEqual(messages.observed("[swarm message #2] old text"), []);
});

test("all queued payloads remain authorized until the genuine settled boundary", () => {
  const posts = new PostObservation();
  const messages = new MessageObservation();
  posts.sent("First complete post", [10]);
  posts.sent("Second complete post", [11]);
  messages.sent([20]);
  messages.sent([21]);
  assert.deepEqual(posts.observed("First complete post\nSecond complete post"), [10, 11]);
  assert.deepEqual(messages.observed("[swarm message #20] first\n[swarm message #21] second"), [20, 21]);
  posts.settled();
  messages.settled();
});

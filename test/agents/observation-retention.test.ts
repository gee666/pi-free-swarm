import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageObservation } from "../../src/agents/message-observation.js";
import { PostObservation } from "../../src/agents/post-observation.js";

test("confirmed queue clears discard cancelled post payloads instead of retaining a lifetime transcript", () => {
  const posts = new PostObservation();
  for (let turn = 1; turn <= 50; turn++) {
    const payload = `Turn ${turn}: ${"界".repeat(5_000)}`;
    posts.sent(payload, [turn]);
    posts.cancelQueued(new Map([[payload, 1]]));
    assert.deepEqual(posts.observed(payload), [], "a cancelled payload cannot advance coverage");
  }
  posts.sent("Current replay of still-uncovered content", [51]);
  assert.deepEqual(posts.observed("Current replay of still-uncovered content"), [51]);
  assert.deepEqual(posts.observed("Current replay of still-uncovered content"), []);
});

test("settlement releases observed dedupe but preserves full queued message authorization", () => {
  const messages = new MessageObservation();
  messages.sent([1], "[swarm message #1] observed first");
  messages.sent([2], "[swarm message #2] current recovery");
  assert.deepEqual(messages.observed("[swarm message #1] observed first"), [1]);
  assert.deepEqual(messages.observed("[swarm message #1] duplicate"), []);
  messages.settled();
  assert.deepEqual(messages.observed("[swarm message #2] late queued text"), []);
  assert.deepEqual(messages.observed("[swarm message #2] current recovery"), [2]);
  assert.deepEqual(messages.observed("[swarm message #2] current recovery"), []);
  messages.settled();
  messages.settled();
  assert.deepEqual(messages.observed("[swarm message #2] old text"), []);
  assert.deepEqual(messages.observed("[swarm message #2] current recovery"), []);
});

test("rejecting one identical post send does not erase another accepted copy", () => {
  const posts = new PostObservation();
  posts.sent("Shared full post", [7]);
  posts.sent("Shared full post", [7]);
  posts.rejected("Shared full post");
  assert.deepEqual(posts.observed("Shared full post"), [7]);
  assert.deepEqual(posts.observed("Shared full post"), []);
});

test("fully observed payloads release authorization before subsequent queue boundaries", () => {
  const posts = new PostObservation();
  const messages = new MessageObservation();
  posts.sent("First complete post", [10]);
  posts.sent("Second complete post", [11]);
  messages.sent([20], "[swarm message #20] first");
  messages.sent([21], "[swarm message #21] second");
  assert.deepEqual(posts.observed("First complete post\nSecond complete post"), [10, 11]);
  assert.deepEqual(messages.observed("[swarm message #20] first\n[swarm message #21] second"), [20, 21]);
  posts.cancelQueued(
    new Map([
      ["First complete post", 1],
      ["Second complete post", 1],
    ]),
  );
  messages.settled();
  assert.deepEqual(posts.observed("First complete post\nSecond complete post"), []);
  assert.deepEqual(messages.observed("[swarm message #20] first\n[swarm message #21] second"), []);
});

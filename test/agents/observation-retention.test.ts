import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageObservation } from "../../src/agents/message-observation.js";

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

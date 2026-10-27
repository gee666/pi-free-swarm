import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSteeringQueue } from "../../src/agents/steering-queue.js";
import { MessageObservation } from "../../src/agents/message-observation.js";
import { FakeTransport } from "./fake-transport.js";

test("confirmed queue clears cancel only removed message proofs", async () => {
  const transport = new FakeTransport({ onEvent: () => undefined, onExit: () => undefined });
  const messages = new MessageObservation();
  messages.sent([1], "[swarm message #1] queued");
  messages.sent([2], "[swarm message #2] retained");
  const cleared = clearSteeringQueue(transport, messages);
  transport.respond({ success: true, data: { steering: ["[swarm message #1] queued"], followUp: [] } });
  assert.equal(await cleared, true);
  assert.deepEqual(messages.observed("[swarm message #1] queued"), []);
  assert.deepEqual(messages.observed("[swarm message #2] retained"), [2]);
});

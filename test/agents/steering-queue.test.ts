import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSteeringQueue } from "../../src/agents/steering-queue.js";
import { MessageObservation } from "../../src/agents/message-observation.js";
import { PostObservation } from "../../src/agents/post-observation.js";
import { FakeTransport } from "./fake-transport.js";

test("a successful clear cannot cancel an active payload absent from the native cleared-text list", async () => {
  for (const data of [undefined, { steering: [], followUp: [] }]) {
    const transport = new FakeTransport({ onEvent: () => {}, onExit: () => {} });
    const messages = new MessageObservation();
    const posts = new PostObservation();
    const text = "[swarm message #4] Active payload";
    messages.sent([4], text);
    posts.sent(text, [7]);
    const clearing = clearSteeringQueue(transport, messages, posts);
    transport.respond({ type: "response", success: true, ...(data ? { data } : {}) });
    assert.equal(await clearing, true);
    assert.deepEqual(messages.observed(text), [4]);
    assert.deepEqual(posts.observed(text), [7]);
    await transport.stop();
  }
});

test("native cancellation counts preserve any remaining identical active authorization", async () => {
  for (const copies of [1, 2]) {
    const transport = new FakeTransport({ onEvent: () => {}, onExit: () => {} });
    const messages = new MessageObservation();
    const posts = new PostObservation();
    const text = "[swarm message #4] Identical active and queued payload";
    messages.sent([4], text);
    messages.sent([4], text);
    posts.sent(text, [7]);
    posts.sent(text, [7]);
    const clearing = clearSteeringQueue(transport, messages, posts);
    transport.respond({
      type: "response",
      success: true,
      data: { steering: Array.from({ length: copies }, () => text), followUp: [] },
    });
    await clearing;
    assert.deepEqual(messages.observed(text), copies === 1 ? [4] : []);
    assert.deepEqual(posts.observed(text), copies === 1 ? [7] : []);
    assert.deepEqual(messages.observed(text), []);
    assert.deepEqual(posts.observed(text), []);
    await transport.stop();
  }
});

for (const success of [false, true]) {
  test(`only a confirmed native queue clear cancels pending message/post proof: success=${success}`, async () => {
    const transport = new FakeTransport({ onEvent: () => {}, onExit: () => {} });
    const messages = new MessageObservation();
    const posts = new PostObservation();
    const text = "[swarm message #4] Full message\nFull post body";
    messages.sent([4], text);
    posts.sent(text, [7]);
    const clearing = clearSteeringQueue(transport, messages, posts);
    assert.deepEqual(transport.commands, [{ type: "clear_queue" }]);
    transport.respond({ type: "response", success, data: { steering: [text], followUp: [] } });
    assert.equal(await clearing, success);
    assert.deepEqual(messages.observed(text), success ? [] : [4]);
    assert.deepEqual(posts.observed(text), success ? [] : [7]);
    await transport.stop();
  });
}

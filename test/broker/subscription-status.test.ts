import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryLoop } from "../../src/broker/delivery.js";
import { markDelivered } from "../../src/broker/delivery-state.js";
import { messagePrompt } from "../../src/broker/message-prompt.js";
import { sendMessage } from "../../src/broker/messages.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { findMessageIds, formatDeliveredMessage, parseDeliveredMessages } from "../../src/message-format.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

// Each comment has its own durable message thread; subscription grouping follows the wall post.
test("notification batches retain every comment and expose one subscription line per wall post", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  const first = createPost(db, swarm.id, "Maria", { title: "First", text: "body" }, T0);
  const second = createPost(db, swarm.id, "Maria", { title: "Second", text: "body" }, T0);
  addComment(db, swarm.id, "John", first.id, "first comment", T0 + 1);
  addComment(db, swarm.id, "John", second.id, "other post", T0 + 2);
  addComment(db, swarm.id, "John", first.id, "last comment", T0 + 3);
  const direct = sendMessage(db, {
    swarmId: swarm.id,
    from: "User",
    to: "Maria",
    text: "ordinary direct message",
    now: T0 + 4,
  });
  const delivery = new DeliveryLoop({ db, swarmId: swarm.id, agents: new Map() });
  const collected = delivery.collect("Maria", false);
  const prompt = messagePrompt(db, swarm.id, "Maria", collected.messageIds);
  assert.ok(prompt);
  assert.equal(prompt.text, collected.text);
  assert.deepEqual(findMessageIds(prompt.text), collected.messageIds);
  const parsed = parseDeliveredMessages(prompt.text);
  assert.equal(parsed.messages.length, 4);
  assert.match(parsed.messages[0].text, /first comment/);
  assert.match(parsed.messages[1].text, /other post/);
  assert.match(parsed.messages[2].text, /last comment/);
  assert.ok(prompt.text.includes(formatDeliveredMessage(direct, "Maria")));
  assert.equal(prompt.text.match(/Subscription:/g)?.length, 2);
  assert.doesNotMatch(parsed.messages[0].text, /Subscription:/);
  assert.match(parsed.messages[1].text, new RegExp(`Subscription: Subscribed to post #${second.id}\\.`));
  assert.match(parsed.messages[2].text, new RegExp(`Subscription: Subscribed to post #${first.id}\\.`));
  assert.match(parsed.messages[2].text, new RegExp(`swarm_unsubscribe\\(\\{post_id: ${first.id}\\}\\)`));
  assert.doesNotMatch(parsed.messages[3].text, /Subscription:/);
  const directOnly = messagePrompt(db, swarm.id, "Maria", [direct.id]);
  assert.equal(directOnly?.text, formatDeliveredMessage(direct, "Maria"));
});

test("transport refresh removes a muted post while preserving other notifications and direct messages", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  const muted = createPost(db, swarm.id, "Maria", { title: "Muted", text: "body" }, T0);
  const kept = createPost(db, swarm.id, "Maria", { title: "Kept", text: "body" }, T0);
  addComment(db, swarm.id, "John", muted.id, "muted comment", T0 + 1);
  addComment(db, swarm.id, "John", kept.id, "kept comment", T0 + 2);
  const direct = sendMessage(db, { swarmId: swarm.id, from: "User", to: "Maria", text: "direct stays", now: T0 + 3 });
  const delivery = new DeliveryLoop({ db, swarmId: swarm.id, agents: new Map() });
  const initial = delivery.collect("Maria", false);
  const prompt = messagePrompt(db, swarm.id, "Maria", initial.messageIds);
  assert.ok(prompt?.beforeSend);
  setPostSubscription(db, swarm.id, "Maria", muted.id, false, T0 + 4);
  const refreshed = prompt.beforeSend();
  assert.ok(refreshed);
  assert.doesNotMatch(refreshed.text, /muted comment/);
  assert.match(refreshed.text, /kept comment/);
  assert.ok(refreshed.text.includes(formatDeliveredMessage(direct, "Maria")));
  assert.equal(refreshed.messageIds?.length, 2);
  assert.equal(refreshed.text.match(/Subscription:/g)?.length, 1);
  assert.match(refreshed.text, new RegExp(`Subscribed to post #${kept.id}\\.`));
  assert.doesNotMatch(refreshed.text, new RegExp(`Subscribed to post #${muted.id}\\.`));
});

test("a delivered notification reports current opt-out state on recovery", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Recovery", text: "body" }, T0);
  addComment(db, swarm.id, "John", post.id, "accepted before opt-out", T0 + 1);
  const delivery = new DeliveryLoop({ db, swarmId: swarm.id, agents: new Map() });
  const initial = delivery.collect("Maria", false);
  markDelivered(db, swarm.id, "Maria", initial.messageIds, T0 + 2);
  setPostSubscription(db, swarm.id, "Maria", post.id, false, T0 + 3);
  const recovered = messagePrompt(db, swarm.id, "Maria", initial.messageIds);
  assert.ok(recovered);
  assert.match(recovered.text, /accepted before opt-out/);
  assert.match(recovered.text, new RegExp(`Subscription: Not subscribed to post #${post.id}\\.`));
  assert.match(recovered.text, new RegExp(`swarm_subscribe\\(\\{post_id: ${post.id}\\}\\)`));
  assert.equal(recovered.text, delivery.collect("Maria", true).text);
});

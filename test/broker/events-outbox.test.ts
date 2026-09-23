import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { recordUsage, setAgentActivity, setAgentStatus } from "../../src/broker/agent-state.js";
import { markDelivered, markRead } from "../../src/broker/delivery-state.js";
import { markUserRead, sendMessage } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { latestEventId, listEventsAfter, pruneEvents } from "../../src/store/events.js";
import { createTempDb, eventTypes, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

/** Event types written by `fn`. */
function emitted(fn: () => void): string[] {
  const before = latestEventId(db);
  fn();
  return listEventsAfter(db, before, 1_000).map((event) => event.type);
}

describe("events outbox", () => {
  const swarm = seedSwarm(db);

  it("writes one row per change, with typed payloads", () => {
    assert.deepEqual(eventTypes(db), ["swarm.updated"]);
    assert.deepEqual(
      emitted(() => createPost(db, swarm.id, "Maria", { title: "t", text: "x" }, T0)),
      ["participant.updated", "post.created"],
      "first write of Maria also publishes her joinedAt",
    );
    assert.deepEqual(
      emitted(() => createPost(db, swarm.id, "Maria", { title: "t2", text: "x" }, T0)),
      ["post.created"],
    );
    const [post] = listEventsAfter(db, 0, 100).filter((event) => event.type === "post.created");
    assert.equal(post.type === "post.created" && post.payload.post.title, "t");
    assert.equal(post.swarmId, swarm.id);
    assert.deepEqual(
      emitted(() => addComment(db, swarm.id, "Maria", 2, "c", T0)),
      ["comment.created"],
    );
  });

  it("covers messages, delivery, agent state and run end", () => {
    let messageId = 0;
    assert.deepEqual(
      emitted(() => (messageId = sendMessage(db, swarm.id, "Maria", ["John", "User"], "hi", T0).id)),
      ["message.created"],
    );
    const created = listEventsAfter(db, 0, 100).find((event) => event.type === "message.created");
    assert.deepEqual(created?.type === "message.created" && created.payload.unread, { John: 1, User: 1 });
    assert.deepEqual(
      emitted(() => markDelivered(db, swarm.id, "John", [messageId], T0)),
      ["message.status"],
    );
    assert.deepEqual(
      emitted(() => markRead(db, swarm.id, "John", [messageId], T0)),
      ["message.status"],
    );
    assert.deepEqual(
      emitted(() => markUserRead(db, swarm.id, [messageId], T0)),
      ["message.status"],
    );
    assert.deepEqual(
      emitted(() => setAgentStatus(db, swarm.id, "John", "working", T0)),
      ["participant.updated", "swarm.updated"],
    );
    assert.deepEqual(
      emitted(() => setAgentStatus(db, swarm.id, "John", "working", T0)),
      [],
    );
    assert.deepEqual(
      emitted(() => setAgentActivity(db, swarm.id, "John", { kind: "thinking" }, T0)),
      ["participant.updated"],
    );
    assert.deepEqual(
      emitted(() => setAgentActivity(db, swarm.id, "John", { kind: "thinking" }, T0)),
      [],
    );
    const sample = { kind: "message" as const, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, model: null };
    assert.deepEqual(
      emitted(() => recordUsage(db, swarm.id, "John", sample, T0)),
      ["usage.updated"],
    );
    const ended = emitted(() => endRun(db, swarm.id, process.pid, "stopped", T0));
    assert.equal(ended.at(-1), "swarm.updated");
    assert.ok(ended.includes("participant.updated"));
  });

  it("rolls the event back with the change", () => {
    const before = latestEventId(db);
    assert.throws(() =>
      db.write(() => {
        createPost(db, swarm.id, "Maria", { title: "gone", text: "x" }, T0);
        throw new Error("abort");
      }),
    );
    assert.equal(latestEventId(db), before);
    assert.throws(() => createPost(db, swarm.id, "Maria", { title: "", text: "x" }, T0));
    assert.equal(latestEventId(db), before);
  });

  it("pages in id order and prunes old rows", () => {
    const all = listEventsAfter(db, 0, 1_000);
    assert.ok(all.every((event, i) => i === 0 || (all[i - 1].id ?? 0) < (event.id ?? 0)));
    assert.equal(listEventsAfter(db, 0, 2).length, 2);
    createPost(db, swarm.id, "Maria", { title: "fresh", text: "x" }, T0 + 100);
    assert.equal(pruneEvents(db, T0 + 1), all.length);
    assert.deepEqual(eventTypes(db), ["post.created"]);
  });
});

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { markDelivered, markRead } from "../../src/broker/delivery-state.js";
import { sendMessage } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { getMessages, listOpenAgentRecipients, unreadCounts } from "../../src/store/message-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function recipient(messageId: number, name: string) {
  return getMessages(db, [messageId])[0].recipients.find((r) => r.name === name);
}

describe("recipient status", () => {
  it("moves pending → delivered → read and never back", () => {
    const swarm = seedSwarm(db);
    const message = sendMessage(db, swarm.id, "Maria", ["John", "Liam"], "hi", T0 + 1);
    assert.equal(markDelivered(db, swarm.id, "john", [message.id], T0 + 2), 1);
    assert.deepEqual(recipient(message.id, "John"), {
      name: "John",
      status: "delivered",
      deliveredAt: T0 + 2,
      readAt: null,
    });
    assert.equal(markRead(db, swarm.id, "John", [message.id], T0 + 3), 1);
    assert.equal(markDelivered(db, swarm.id, "John", [message.id], T0 + 4), 0);
    assert.equal(markRead(db, swarm.id, "John", [message.id], T0 + 5), 0);
    assert.deepEqual(recipient(message.id, "John"), {
      name: "John",
      status: "read",
      deliveredAt: T0 + 2,
      readAt: T0 + 3,
    });
    assert.equal(recipient(message.id, "Liam")?.status, "pending");
  });

  it("fills delivered_at when the read signal comes first", () => {
    const swarm = seedSwarm(db);
    const message = sendMessage(db, swarm.id, "Maria", ["John"], "hi", T0 + 1);
    assert.equal(markRead(db, swarm.id, "John", [message.id, message.id], T0 + 7), 1);
    assert.deepEqual(recipient(message.id, "John"), {
      name: "John",
      status: "read",
      deliveredAt: T0 + 7,
      readAt: T0 + 7,
    });
    assert.equal(markDelivered(db, swarm.id, "John", [message.id], T0 + 8), 0);
  });

  it("keeps undeliverable final", () => {
    const swarm = seedSwarm(db);
    const message = sendMessage(db, swarm.id, "Maria", ["John"], "hi", T0 + 1);
    endRun(db, swarm.id, process.pid, "stopped", T0 + 2);
    assert.equal(markDelivered(db, swarm.id, "John", [message.id], T0 + 3), 0);
    assert.equal(markRead(db, swarm.id, "John", [message.id], T0 + 3), 0);
    assert.equal(recipient(message.id, "John")?.status, "undeliverable");
  });

  it("lists open agent recipients and counts unread", () => {
    const swarm = seedSwarm(db);
    const a = sendMessage(db, swarm.id, "Maria", ["John", "User"], "a", T0 + 1);
    const b = sendMessage(db, swarm.id, "User", ["Liam", "John"], "b", T0 + 1);
    markDelivered(db, swarm.id, "John", [a.id], T0 + 2);
    assert.deepEqual(listOpenAgentRecipients(db, swarm.id), [
      { messageId: a.id, name: "John", status: "delivered" },
      { messageId: b.id, name: "Liam", status: "pending" },
      { messageId: b.id, name: "John", status: "pending" },
    ]);
    assert.deepEqual(unreadCounts(db, swarm.id, ["John", "Liam", "User", "Maria"]), {
      John: 2,
      Liam: 1,
      User: 1,
      Maria: 0,
    });
  });
});

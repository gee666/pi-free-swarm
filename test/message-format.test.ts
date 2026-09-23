import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageView } from "../src/api-types.js";
import {
  findMessageIds,
  formatDeliveredMessage,
  formatDeliveredMessages,
  parseDeliveredMessages,
} from "../src/message-format.js";

function message(id: number, text: string): MessageView {
  const recipient = (name: string) => ({ name, status: "pending" as const, deliveredAt: null, readAt: null });
  return {
    id,
    swarmId: 1,
    threadId: 12,
    sender: "Maria",
    senderKind: "agent",
    text,
    createdAt: 0,
    recipients: [recipient("John"), recipient("Liam")],
  };
}

describe("message format", () => {
  it("shows the recipient as You", () => {
    assert.equal(
      formatDeliveredMessage(message(87, "I take token.ts"), "liam"),
      '[swarm message #87] thread #12 · from Maria · to: John, You\n"I take token.ts"\n(reply with swarm_reply_to(12, …))',
    );
  });

  it("finds every marker and parses blocks back", () => {
    const text = `Intro\n\n${formatDeliveredMessages([message(1, "a"), message(2, "b\nc")], "John")}`;
    assert.deepEqual(findMessageIds(text), [1, 2]);
    const parsed = parseDeliveredMessages(text);
    assert.equal(parsed.rest, "Intro");
    assert.deepEqual(
      parsed.messages.map((m) => [m.messageId, m.threadId, m.from, m.to, m.text]),
      [
        [1, 12, "Maria", ["You", "Liam"], "a"],
        [2, 12, "Maria", ["You", "Liam"], "b\nc"],
      ],
    );
  });
});

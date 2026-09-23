import { describe, expect, it } from "vitest";
import type { SwarmEvent } from "../../../../src/api-types";
import { applyMailboxEvent, withOlderThreads } from "./mailboxModel";
import { canUserReply, visibleRecipients } from "./messageDisplay";
import { eventBase, mailbox, mailboxThread, message, thread } from "./testFixtures";

const first = message(1, "John", [["Maria", "delivered"]], "one");
const second = message(2, "Liam", [["Maria", "read"]], "two");
const inbox = mailbox("Maria", "inbox", [
  mailboxThread(thread(1, ["John", "Maria"]), [first], "Maria"),
  mailboxThread(thread(2, ["Liam", "Maria"]), [second], "Maria"),
]);

const created = (item: ReturnType<typeof message>): SwarmEvent => ({
  ...eventBase,
  type: "message.created",
  payload: { message: item, unread: {} },
});

describe("applyMailboxEvent", () => {
  it("moves a known thread to the top with the new message and its unread count", () => {
    const reply = message(2, "Liam", [["Maria", "pending"]], "three");
    const patch = applyMailboxEvent(inbox, created(reply));
    if (patch.kind !== "patched") throw new Error(`expected a patch, got ${patch.kind}`);
    expect(patch.mailbox.threads.map((item) => item.thread.id)).toEqual([2, 1]);
    expect(patch.mailbox.threads[0]).toMatchObject({ unread: 1, lastMessageAt: reply.createdAt });
  });

  it("ignores messages outside the box and asks for a reload for new threads", () => {
    expect(applyMailboxEvent(inbox, created(message(3, "John", [["Liam", "pending"]], "x"))).kind).toBe("unchanged");
    expect(applyMailboxEvent(inbox, created(message(3, "John", [["Maria", "pending"]], "x"))).kind).toBe("reload");
  });

  it("updates recipient statuses and recounts unread", () => {
    const status: SwarmEvent = {
      ...eventBase,
      type: "message.status",
      payload: {
        messageId: first.id,
        threadId: 1,
        recipient: { name: "Maria", status: "read", deliveredAt: 1, readAt: 2 },
        unread: { Maria: 0 },
      },
    };
    const patch = applyMailboxEvent(inbox, status);
    if (patch.kind !== "patched") throw new Error(`expected a patch, got ${patch.kind}`);
    expect(patch.mailbox.threads[0].unread).toBe(0);
  });

  it("skips duplicates when appending an older page", () => {
    const page = mailbox("Maria", "inbox", [
      inbox.threads[1],
      mailboxThread(thread(9, ["Ava", "Maria"]), [first], "Maria"),
    ]);
    expect(withOlderThreads(inbox, page).threads.map((item) => item.thread.id)).toEqual([1, 2, 9]);
    expect(withOlderThreads(inbox, { ...page, box: "sent" })).toBe(inbox);
  });
});

describe("message display", () => {
  const toBoth = message(
    1,
    "John",
    [
      ["Maria", "read"],
      ["User", "delivered"],
    ],
    "hi",
  );

  it("shows only the viewer's own status in their inbox and nothing for System", () => {
    expect(visibleRecipients(toBoth, "Maria", "inbox").map(({ name }) => name)).toEqual(["Maria"]);
    expect(visibleRecipients(toBoth, "John", "sent").map(({ name }) => name)).toEqual(["Maria", "You"]);
    const system = message(1, "System", [["User", "delivered"]], "The swarm is finished.");
    expect(visibleRecipients(system, "User", "inbox")).toEqual([]);
  });

  it("lets the user reply only as a member with somebody to reach", () => {
    expect(canUserReply(thread(1, ["User", "Maria"]))).toBe(true);
    expect(canUserReply(thread(1, ["John", "Maria"]))).toBe(false);
    expect(canUserReply(thread(1, ["Main", "User", "System"]))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ParticipantView, SwarmEvent } from "../../../src/api-types";
import { agent, detail, eventBase, message } from "../pages/agents/testFixtures";
import { applyParticipantEvent } from "./agents";

const participants: ParticipantView[] = detail().participants;
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1.5, turns: 1 };

describe("applyParticipantEvent", () => {
  it("replaces an updated participant in place and appends unknown ones", () => {
    const working = agent("Maria", 2, { status: "working" });
    const updated = applyParticipantEvent(participants, {
      ...eventBase,
      type: "participant.updated",
      payload: { participant: working },
    });
    expect(updated.map(({ name }) => name)).toEqual(["User", "John", "Maria", "Emma"]);
    expect(updated[2]).toBe(working);

    const newcomer = agent("Zoe", 4);
    const appended = applyParticipantEvent(participants, {
      ...eventBase,
      type: "participant.updated",
      payload: { participant: newcomer },
    });
    expect(appended.at(-1)).toBe(newcomer);
  });

  it("takes the agent's cost from usage.updated", () => {
    const updated = applyParticipantEvent(participants, {
      ...eventBase,
      type: "usage.updated",
      payload: { agent: "John", usage },
    });
    expect(updated[1]).toMatchObject({ name: "John", cost: 1.5 });
    expect(updated[2]).toBe(participants[2]);
  });

  it("applies the unread maps of message events", () => {
    const created: SwarmEvent = {
      ...eventBase,
      type: "message.created",
      payload: { message: message(1, "John", [["User", "delivered"]], "hi"), unread: { User: 4, Maria: 0 } },
    };
    const updated = applyParticipantEvent(participants, created);
    expect(updated.map(({ unread }) => unread)).toEqual([4, 2, 0, 12]);
  });

  it("keeps the same array when nothing changes", () => {
    const unchanged: SwarmEvent = {
      ...eventBase,
      type: "message.status",
      payload: {
        messageId: 1,
        threadId: 1,
        recipient: { name: "John", status: "read", deliveredAt: 1, readAt: 1 },
        unread: { John: 2 },
      },
    };
    expect(applyParticipantEvent(participants, unchanged)).toBe(participants);
    const other: SwarmEvent = { ...eventBase, type: "session.appended", payload: { agent: "John", newestCursor: "4" } };
    expect(applyParticipantEvent(participants, other)).toBe(participants);
  });
});

import type { MarkReadResponse, MessageView, ThreadView } from "../api-types.js";
import {
  MAIN_FEEDBACK_POST_SUFFIX,
  MAIN_FEEDBACK_POST_TITLE,
  MAIN_NAME,
  PAGE_DEFAULT_COUNT,
  USER_NAME,
  WATCHER_NAME,
} from "../constants.js";
import { clipWithSuffix, MAIN_FEEDBACK_MAX, WORK_TEXT_ACCEPTED } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { findDirectThreadView, getMessages, unreadCounts } from "../store/message-queries.js";
import { int } from "../store/rows.js";
import { listAgentSessions, listMessageableNames, type ParticipantRef } from "../store/swarm-queries.js";
import { storedBody } from "./attachment.js";
import { markRead } from "./delivery-state.js";
import { BrokerError } from "./errors.js";
import { createThread, sendToThread } from "./message-insert.js";
import { notifyLocalMessage } from "./notify.js";
import { actAs, checkPage, requireParticipant, requireSwarm, requireText } from "./validate.js";
import { createPost } from "./wall.js";

export function announceUserMessage(swarmName: string, message: MessageView, notifyUser: (text: string) => void): void {
  if (message.senderKind === "agent") notifyUser(`Swarm "${swarmName}": ${message.sender} → User: ${message.text}`);
}

function recipient(db: SwarmDb, swarmId: number, sender: string, to: string): ParticipantRef {
  if (typeof to !== "string") throw new BrokerError("validation", "to must name exactly one recipient.", "to");
  const peer = requireParticipant(db, swarmId, to.trim());
  if (peer.retiredAt !== undefined)
    throw new BrokerError("validation", `Worker ${peer.name} is retired. Choose an active recipient.`, "to");
  if ((peer.kind !== "agent" && peer.kind !== "user") || peer.name === sender)
    throw new BrokerError(
      "validation",
      `Choose one recipient other than yourself. Available: ${listMessageableNames(db, swarmId).join(", ")}.`,
      "to",
    );
  return peer;
}

export function sendMessage(
  db: SwarmDb,
  input: {
    swarmId: number;
    from: string;
    to: string;
    text: string;
    now: number;
  },
): MessageView {
  const { swarmId, from, to, text, now } = input;
  return db.write(() => {
    requireSwarm(db, swarmId);
    const sender = actAs(db, swarmId, from, now);
    const peer = recipient(db, swarmId, sender.name, to);
    const existing = findDirectThreadView(db, swarmId, sender.name, peer.name);
    const threadId = existing?.id ?? createThread(db, swarmId, [sender.name, peer.name], now);
    const value = storedBody(db, swarmId, "message", text, sender.kind);
    const result = sendToThread(db, { swarmId, threadId, sender, recipients: [peer], text: value, now });
    if (result.pending) db.afterCommit(() => notifyLocalMessage(swarmId));
    return result.message;
  });
}

export function readConversation(
  db: SwarmDb,
  input: {
    swarmId: number;
    a: string;
    b: string;
    after?: number;
    limit?: number;
  },
): { thread: ThreadView | null; messages: MessageView[]; nextAfter: number | null } {
  return db.read(() => {
    const { swarmId, a, b, after = 0, limit = PAGE_DEFAULT_COUNT } = input;
    requireSwarm(db, swarmId);
    checkPage({ count: limit, offset: after });
    const reader = requireParticipant(db, swarmId, a);
    const peer = requireParticipant(db, swarmId, b);
    const found = findDirectThreadView(db, swarmId, reader.name, peer.name);
    if (!found) return { thread: null, messages: [], nextAfter: null };
    const rows = db.sql
      .prepare("SELECT id FROM messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT ?")
      .all(found.id, after, limit + 1);
    const ids = rows.slice(0, limit).map((row) => int(row, "id"));
    return {
      thread: found,
      messages: getMessages(db, ids),
      nextAfter: rows.length > limit ? (ids.at(-1) ?? null) : null,
    };
  });
}

export function feedbackPostBody(feedback: string, max: number): string {
  return clipWithSuffix(feedback, MAIN_FEEDBACK_POST_SUFFIX, max);
}

export function sendMainFeedback(
  db: SwarmDb,
  swarmId: number,
  text: string,
  now: number,
  instructions = "",
): MessageView {
  return db.write(() => {
    requireSwarm(db, swarmId);
    const value = requireText(text, MAIN_FEEDBACK_MAX, "message");
    const sender = actAs(db, swarmId, MAIN_NAME, now);
    const messages = listAgentSessions(db, swarmId, { activeOnly: true })
      .filter((agent) => agent.name !== WATCHER_NAME)
      .map((agent) => {
        const peer: ParticipantRef = { name: agent.name, kind: "agent" };
        const threadId =
          findDirectThreadView(db, swarmId, sender.name, peer.name)?.id ??
          createThread(db, swarmId, [sender.name, peer.name], now);
        return sendToThread(db, {
          swarmId,
          threadId,
          sender,
          recipients: [peer],
          text: instructions ? `${value}\n\n${instructions}` : value,
          now,
        }).message;
      });
    const first = messages[0];
    if (!first) throw new BrokerError("validation", "No active workers to receive feedback.");
    createPost(
      db,
      swarmId,
      MAIN_NAME,
      { title: MAIN_FEEDBACK_POST_TITLE, text: feedbackPostBody(value, WORK_TEXT_ACCEPTED) },
      now,
    );
    db.afterCommit(() => notifyLocalMessage(swarmId));
    return first;
  });
}

export function markUserRead(
  db: SwarmDb,
  swarmId: number,
  messageIds: readonly number[],
  now: number,
): MarkReadResponse {
  return db.write(() => {
    requireSwarm(db, swarmId);
    const updated = markRead(db, swarmId, USER_NAME, messageIds, now);
    return { updated, unread: unreadCounts(db, swarmId, [USER_NAME])[USER_NAME] };
  });
}

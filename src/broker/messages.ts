// Message writes: new threads, replies, Main's feedback and the User's read marks.
import type { MarkReadResponse, MessageView, ThreadResponse } from "../api-types.js";
import { MAIN_FEEDBACK_POST_SUFFIX, MAIN_FEEDBACK_POST_TITLE, MAIN_NAME, USER_NAME } from "../constants.js";
import { charCount, MAIN_FEEDBACK_MAX, TEXT_MAX } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { getThread, getThreadView, unreadCounts } from "../store/message-queries.js";
import { count } from "../store/rows.js";
import {
  findParticipant,
  listAgentSessions,
  listMessageableNames,
  type ParticipantRef,
} from "../store/swarm-queries.js";
import { emitRecipientStatus } from "./emit.js";
import { BrokerError } from "./errors.js";
import { createThread, sendToThread } from "./message-insert.js";
import { notifyLocalMessage } from "./notify.js";
import { actAs, requireParticipant, requireSwarm, requireText } from "./validate.js";
import { createPost } from "./wall.js";

type SendResult = { message: MessageView; pending: boolean };

function afterCommit(swarmId: number, result: SendResult): MessageView {
  if (result.pending) notifyLocalMessage(swarmId);
  return result.message;
}

const canReceive = (participant: ParticipantRef): boolean =>
  participant.kind === "agent" || participant.kind === "user";

/** Agents and User only (Main and System never receive), minus the sender, deduplicated, canonical. */
function resolveRecipients(
  db: SwarmDb,
  swarmId: number,
  sender: ParticipantRef,
  to: readonly string[],
): ParticipantRef[] {
  const recipients: ParticipantRef[] = [];
  const unknown: string[] = [];
  for (const raw of to) {
    const name = raw.trim();
    const participant = findParticipant(db, swarmId, name);
    if (participant === null || !canReceive(participant)) unknown.push(name);
    else if (participant.name !== sender.name && !recipients.some((r) => r.name === participant.name)) {
      recipients.push(participant);
    }
  }
  if (unknown.length > 0) {
    const label = unknown.length === 1 ? "Unknown participant" : "Unknown participants";
    const known = listMessageableNames(db, swarmId).join(", ");
    throw new BrokerError("validation", `${label}: ${unknown.join(", ")}. Known participants: ${known}.`, "to");
  }
  if (recipients.length === 0) {
    throw new BrokerError("validation", "Add at least one recipient other than yourself.", "to");
  }
  return recipients;
}

/** Starts a new thread whose members are the sender and `to`. */
export function sendMessage(
  db: SwarmDb,
  swarmId: number,
  from: string,
  to: readonly string[],
  text: string,
  now: number,
): MessageView {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const sender = actAs(db, swarmId, from, now);
    const value = requireText(text);
    const recipients = resolveRecipients(db, swarmId, sender, to);
    const threadId = createThread(db, swarmId, [sender.name, ...recipients.map((r) => r.name)], now);
    return sendToThread(db, { swarmId, threadId, sender, recipients, text: value, now });
  });
  return afterCommit(swarmId, result);
}

/** Sends to every thread member except the sender (and Main, which never receives). */
export function replyToThread(
  db: SwarmDb,
  swarmId: number,
  from: string,
  threadId: number,
  text: string,
  now: number,
): MessageView {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const sender = actAs(db, swarmId, from, now);
    const thread = getThreadView(db, swarmId, threadId);
    if (thread === null) throw new BrokerError("not_found", `Thread #${threadId} not found.`);
    if (!thread.members.includes(sender.name)) {
      throw new BrokerError("not_member", `You are not a member of thread #${threadId}.`);
    }
    const value = requireText(text);
    const recipients = thread.members
      .filter((name) => name !== sender.name)
      .flatMap((name) => findParticipant(db, swarmId, name) ?? [])
      .filter(canReceive);
    if (recipients.length === 0) throw new BrokerError("validation", `Nobody else is in thread #${threadId}.`);
    return sendToThread(db, { swarmId, threadId, sender, recipients, text: value, now });
  });
  return afterCommit(swarmId, result);
}

/** The wall post that points agents at Main's feedback; always ends with the suffix and fits TEXT_MAX. */
export function feedbackPostBody(feedback: string): string {
  const room = TEXT_MAX - 1 - charCount(MAIN_FEEDBACK_POST_SUFFIX);
  const chars = Array.from(feedback);
  const head = chars.length <= room ? feedback : chars.slice(0, room).join("").trimEnd();
  return `${head} ${MAIN_FEEDBACK_POST_SUFFIX}`;
}

/** Resume feedback: a new thread from Main to every agent plus a short wall post by Main. */
export function sendMainFeedback(db: SwarmDb, swarmId: number, text: string, now: number): MessageView {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const value = requireText(text, MAIN_FEEDBACK_MAX, "message");
    const sender = actAs(db, swarmId, MAIN_NAME, now);
    const recipients = listAgentSessions(db, swarmId).map((agent): ParticipantRef => ({
      name: agent.name,
      kind: "agent",
    }));
    const threadId = createThread(db, swarmId, [sender.name, ...recipients.map((r) => r.name)], now);
    const sent = sendToThread(db, { swarmId, threadId, sender, recipients, text: value, now });
    createPost(db, swarmId, MAIN_NAME, { title: MAIN_FEEDBACK_POST_TITLE, text: feedbackPostBody(value) }, now);
    return sent;
  });
  return afterCommit(swarmId, result);
}

/** Only members may read a thread through the agent tools. */
export function readThreadAs(db: SwarmDb, swarmId: number, reader: string, threadId: number): ThreadResponse {
  requireSwarm(db, swarmId);
  const participant = requireParticipant(db, swarmId, reader);
  const thread = getThread(db, swarmId, threadId);
  if (thread === null) throw new BrokerError("not_found", `Thread #${threadId} not found.`);
  if (!thread.thread.members.includes(participant.name)) {
    throw new BrokerError("not_member", `You are not a member of thread #${threadId}.`);
  }
  return thread;
}

/** The user opened these messages in the UI. Other recipients and final statuses are untouched. */
export function markUserRead(
  db: SwarmDb,
  swarmId: number,
  messageIds: readonly number[],
  now: number,
): MarkReadResponse {
  return db.write(() => {
    requireSwarm(db, swarmId);
    const update = db.sql.prepare(
      `UPDATE message_recipients SET status = 'read', read_at = ?, delivered_at = COALESCE(delivered_at, ?)
       WHERE message_id = ? AND swarm_id = ? AND name = ? AND status IN ('pending', 'delivered')`,
    );
    let updated = 0;
    for (const messageId of new Set(messageIds)) {
      if (count(update.run(now, now, messageId, swarmId, USER_NAME).changes) === 0) continue;
      updated++;
      emitRecipientStatus(db, swarmId, messageId, USER_NAME, now);
    }
    return { updated, unread: unreadCounts(db, swarmId, [USER_NAME])[USER_NAME] };
  });
}

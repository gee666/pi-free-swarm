import type {
  MailboxKind,
  MailboxResponse,
  MailboxThread,
  MessageView,
  RecipientView,
  SwarmEvent,
} from "../../../../src/api-types";
import { insertNewest, newestFirst } from "../../lib/newestFirst";

/** Not yet read by `name`: pending or delivered (the definition behind every unread badge). */
export function isUnreadFor(message: MessageView, name: string): boolean {
  const entry = message.recipients.find((recipient) => recipient.name === name);
  return entry !== undefined && (entry.status === "pending" || entry.status === "delivered");
}

/** Whether `message` shows up in `name`'s box. */
export function belongsToBox(message: MessageView, name: string, box: MailboxKind): boolean {
  return box === "sent" ? message.sender === name : message.recipients.some((recipient) => recipient.name === name);
}

/** Replaces one recipient entry of one message; keeps the array when that message isn't in it. */
export function withRecipient(messages: MessageView[], messageId: number, recipient: RecipientView): MessageView[] {
  if (!messages.some((message) => message.id === messageId)) return messages;
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          recipients: message.recipients.map((entry) => (entry.name === recipient.name ? recipient : entry)),
        }
      : message,
  );
}

export const withMessage = insertNewest<MessageView>;

function orderThreads(threads: readonly MailboxThread[]): MailboxThread[] {
  return [...threads].sort(
    (left, right) => right.lastMessageAt - left.lastMessageAt || right.thread.id - left.thread.id,
  );
}

export function orderMailbox(mailbox: MailboxResponse): MailboxResponse {
  return {
    ...mailbox,
    threads: orderThreads(
      mailbox.threads.map((thread) => ({
        ...thread,
        messages: newestFirst(thread.messages),
      })),
    ),
  };
}

function recount(thread: MailboxThread, name: string, box: MailboxKind): MailboxThread {
  const unread = box === "inbox" ? thread.messages.filter((message) => isUnreadFor(message, name)).length : 0;
  return unread === thread.unread ? thread : { ...thread, unread };
}

export type MailboxPatch = { kind: "unchanged" } | { kind: "patched"; mailbox: MailboxResponse } | { kind: "reload" };

/**
 * Applies a message event to a loaded mailbox. A message that starts a thread missing from the page asks for a
 * reload: the event lacks the thread record (members) the row needs.
 */
export function applyMailboxEvent(mailbox: MailboxResponse, event: SwarmEvent): MailboxPatch {
  const { name, box } = mailbox;
  if (event.type === "message.created") {
    const { message } = event.payload;
    if (!belongsToBox(message, name, box)) return { kind: "unchanged" };
    const current = mailbox.threads.find((thread) => thread.thread.id === message.threadId);
    if (!current) return { kind: "reload" };
    const messages = withMessage(current.messages, message);
    if (messages === current.messages) return { kind: "unchanged" };
    const updated = recount(
      { ...current, messages, lastMessageAt: Math.max(current.lastMessageAt, message.createdAt) },
      name,
      box,
    );
    const rest = mailbox.threads.filter((thread) => thread !== current);
    return { kind: "patched", mailbox: { ...mailbox, threads: orderThreads([updated, ...rest]) } };
  }
  if (event.type === "message.status") {
    const { messageId, threadId, recipient } = event.payload;
    let changed = false;
    const threads = mailbox.threads.map((thread) => {
      if (thread.thread.id !== threadId) return thread;
      const messages = withRecipient(thread.messages, messageId, recipient);
      if (messages === thread.messages) return thread;
      changed = true;
      return recount({ ...thread, messages }, name, box);
    });
    return changed ? { kind: "patched", mailbox: { ...mailbox, threads } } : { kind: "unchanged" };
  }
  return { kind: "unchanged" };
}

/** Appends an older page, skipping threads that moved into the first page meanwhile. */
export function withOlderThreads(mailbox: MailboxResponse, page: MailboxResponse): MailboxResponse {
  if (page.name !== mailbox.name || page.box !== mailbox.box) return mailbox;
  const known = new Set(mailbox.threads.map((thread) => thread.thread.id));
  const older = page.threads.filter((thread) => !known.has(thread.thread.id));
  return { ...mailbox, threads: orderThreads([...mailbox.threads, ...older]), total: page.total };
}

import type { MailboxKind, MessageView, RecipientView, ReservedName, ThreadView } from "../../../../src/api-types";
import { displayName, USER_NAME } from "../../api/agents";

/** Senders that never receive messages, so a reply never goes to them. */
const SENDERS_ONLY: readonly string[] = ["Main", "System"] satisfies ReservedName[];

/**
 * Delivery entries shown for a message: none for `System` auto-replies, only the viewer's own entry in their
 * inbox, every recipient otherwise. Names are display names ("You").
 */
export function visibleRecipients(message: MessageView, viewer: string, box: MailboxKind): RecipientView[] {
  if (message.senderKind === "system") return [];
  const own = message.recipients.filter((recipient) => recipient.name === viewer);
  const shown = box === "inbox" && own.length > 0 ? own : message.recipients;
  return shown.map((recipient) => ({ ...recipient, name: displayName(recipient.name) }));
}

/** Who a reply from the user reaches: the members minus the user and the senders-only. */
export function replyRecipients(thread: ThreadView): string[] {
  return thread.members.filter((name) => name !== USER_NAME && !SENDERS_ONLY.includes(name));
}

/** The user can reply once they are a member and somebody else would receive it. */
export function canUserReply(thread: ThreadView): boolean {
  return thread.members.includes(USER_NAME) && replyRecipients(thread).length > 0;
}

/** Collapsed rows show the first line of the last message as the subject. */
export function subjectOf(text: string): string {
  return text.split("\n", 1)[0];
}

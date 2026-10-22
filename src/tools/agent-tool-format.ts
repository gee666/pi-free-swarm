import type { MessageView } from "../api-types.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../constants.js";

/** A message stored while the swarm is not running reaches nobody; tell the sender plainly. */
export function formatSent(message: MessageView, verb: "Sent" | "Replied"): string {
  if (message.recipients.some((recipient) => recipient.status === "undeliverable")) return UNDELIVERABLE_REPLY_TEXT;
  const to = message.recipients.map((recipient) => recipient.name).join(", ");
  return `${verb} message #${message.id} in thread #${message.threadId} to ${to}.`;
}

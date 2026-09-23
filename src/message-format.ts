// How a swarm message looks inside an agent prompt. The runner writes it, the supervisor finds the
// `[swarm message #id]` markers to detect reads, and the session reader turns it back into items.
import type { MessageView } from "./api-types.js";
import { AGENT_TOOL } from "./constants.js";

export interface ParsedSwarmMessage {
  messageId: number;
  threadId: number;
  from: string;
  to: string[];
  text: string;
}

const YOU = "You";
const MARKER = /\[swarm message #(\d+)\]/g;
const BLOCK = new RegExp(
  String.raw`\[swarm message #(\d+)\] thread #(\d+) · from ([^\n]+?) · to: ([^\n]*)\n"([\s\S]*?)"\n` +
    String.raw`\(reply with ${AGENT_TOOL.replyTo}\(\2, …\)\)`,
  "g",
);

/** One message as shown to `recipient`, who appears as "You" in the `to` list. */
export function formatDeliveredMessage(message: MessageView, recipient: string): string {
  const to = message.recipients.map((r) => (r.name.toLowerCase() === recipient.toLowerCase() ? YOU : r.name));
  return [
    `[swarm message #${message.id}] thread #${message.threadId} · from ${message.sender} · to: ${to.join(", ")}`,
    `"${message.text}"`,
    `(reply with ${AGENT_TOOL.replyTo}(${message.threadId}, …))`,
  ].join("\n");
}

/** Several messages delivered in one prompt keep one header each. */
export function formatDeliveredMessages(messages: readonly MessageView[], recipient: string): string {
  return messages.map((message) => formatDeliveredMessage(message, recipient)).join("\n\n");
}

/** Message ids referenced in a user message, in order of appearance. */
export function findMessageIds(text: string): number[] {
  return Array.from(text.matchAll(MARKER), (match) => Number(match[1]));
}

/** Splits a user message into its swarm messages and the remaining prompt text (trimmed, may be empty). */
export function parseDeliveredMessages(text: string): { messages: ParsedSwarmMessage[]; rest: string } {
  const messages: ParsedSwarmMessage[] = [];
  const rest = text.replace(BLOCK, (_block, id: string, thread: string, from: string, to: string, body: string) => {
    messages.push({
      messageId: Number(id),
      threadId: Number(thread),
      from,
      to: to.split(", ").filter((name) => name.length > 0),
      text: body,
    });
    return "";
  });
  return { messages, rest: rest.replace(/\n{3,}/g, "\n\n").trim() };
}

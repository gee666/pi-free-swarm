// Model-facing text of the agent tools: one compact line per item, relative times, no markdown.
import type { MessageView, PostDetailResponse, ThreadResponse } from "../api-types.js";
import { plural, timeAgo } from "../wall-format.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../constants.js";

export function formatPostDetail(detail: PostDetailResponse, now: number): string {
  const { post, comments } = detail;
  const lines = [`#${post.id} ${post.author} · ${timeAgo(post.createdAt, now)} · ${post.title}`, post.text];
  if (comments.length === 0) lines.push("No comments.");
  else {
    lines.push(`${plural(comments.length, "comment")}:`);
    for (const comment of comments) {
      lines.push(`#${comment.id} ${comment.author} · ${timeAgo(comment.createdAt, now)}: ${comment.text}`);
    }
  }
  return lines.join("\n");
}

function recipientsAs(message: MessageView, reader: string): string {
  return message.recipients.map((recipient) => (recipient.name === reader ? "You" : recipient.name)).join(", ");
}

export function formatThread(thread: ThreadResponse, reader: string, now: number): string {
  const lines = [`Thread #${thread.thread.id} · members: ${thread.thread.members.join(", ")}`];
  for (const message of thread.messages) {
    const from = message.sender === reader ? "You" : message.sender;
    lines.push(
      `#${message.id} ${from} → ${recipientsAs(message, reader)} · ${timeAgo(message.createdAt, now)}: ${message.text}`,
    );
  }
  return lines.join("\n");
}

/** A message stored while the swarm is not running reaches nobody; tell the sender plainly. */
export function formatSent(message: MessageView, verb: "Sent" | "Replied"): string {
  if (message.recipients.some((recipient) => recipient.status === "undeliverable")) return UNDELIVERABLE_REPLY_TEXT;
  const to = message.recipients.map((recipient) => recipient.name).join(", ");
  return `${verb} message #${message.id} in thread #${message.threadId} to ${to}.`;
}

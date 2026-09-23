// Model-facing text of the agent tools: one compact line per item, relative times, no markdown.
import type { MessageView, PostDetailResponse, PostListResponse, PostSummary, ThreadResponse } from "../api-types.js";
import { UNDELIVERABLE_REPLY_TEXT } from "../constants.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(then: number, now: number): string {
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `#12 Maria · 5m ago · Kickoff — text (4 comments) (new)` */
export function formatPostLine(post: PostSummary, now: number, isNew: boolean): string {
  const line = `#${post.id} ${post.author} · ${timeAgo(post.createdAt, now)} · ${post.title} — ${post.text}`;
  return `${line} (${plural(post.commentCount, "comment")})${isNew ? " (new)" : ""}`;
}

export function formatPostList(
  page: PostListResponse,
  newPostIds: readonly number[],
  offset: number,
  now: number,
): string {
  if (page.total === 0) return "The wall is empty.";
  if (page.posts.length === 0) return `No posts at offset ${offset} (${page.total} total).`;
  const fresh = new Set(newPostIds);
  const lines = page.posts.map((post) => formatPostLine(post, now, fresh.has(post.id)));
  if (page.posts.length < page.total) {
    lines.unshift(`Posts ${offset + 1}–${offset + page.posts.length} of ${page.total}, newest first:`);
  }
  return lines.join("\n");
}

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

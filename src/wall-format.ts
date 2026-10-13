import type { PostListResponse, PostSummary } from "./api-types.js";

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

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatPostLine(post: PostSummary, now: number, isNew: boolean, previewChars: number): string {
  const chars = Array.from(post.text);
  const preview =
    chars.length > previewChars
      ? `${chars.slice(0, previewChars).join("")} … (read post #${post.id} for full text)`
      : post.text;
  const line = `#${post.id} ${post.author} · ${timeAgo(post.createdAt, now)} · ${post.title} — ${preview}`;
  return `${line} (${plural(post.commentCount, "comment")})${isNew ? " (new)" : ""}`;
}

export function formatPostList(
  page: PostListResponse,
  newPostIds: readonly number[],
  offset: number,
  now: number,
  previewChars: number,
): string {
  if (page.total === 0) return "The wall is empty.";
  if (page.posts.length === 0) return `No posts at offset ${offset} (${page.total} total).`;
  const fresh = new Set(newPostIds);
  const lines = page.posts.map((post) => formatPostLine(post, now, fresh.has(post.id), previewChars));
  if (page.posts.length < page.total) {
    lines.unshift(`Posts ${offset + 1}–${offset + page.posts.length} of ${page.total}, newest first:`);
  }
  return lines.join("\n");
}

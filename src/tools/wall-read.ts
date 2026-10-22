import { encodeWallCursor, initialWallCursor, readWallDeltaAs, wallPreviewChars } from "../broker/wall-delta.js";
import { readPostsAs } from "../broker/wall.js";
import { checkPage } from "../broker/validate.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { formatPostList } from "../wall-format.js";
import { markPostsCovered, markCommentsCovered } from "../store/wall-coverage.js";

const OVERVIEW_ITEMS = 12;
const OVERVIEW_CHARS = 500;

/** Shared execution helper; registration keeps the existing history parameters optional. */
export function readWallTool(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  input: { count?: number; offset?: number; after?: string },
  now: number,
): string {
  if (input.after === undefined) {
    const requested = input.count ?? PAGE_DEFAULT_COUNT;
    const count = Math.min(requested, OVERVIEW_ITEMS);
    const offset = input.offset ?? 0;
    checkPage({ count: requested, offset });
    const result = readPostsAs(db, swarmId, reader, { count, offset });
    const preview = Math.min(wallPreviewChars(db), OVERVIEW_CHARS);
    markPostsCovered(
      db,
      swarmId,
      reader,
      result.page.posts
        .filter((post) => Array.from(post.text.replaceAll("\n", "\\n")).length <= preview)
        .map((post) => post.id),
    );
    const page = {
      ...result.page,
      posts: result.page.posts.map((post) => ({ ...post, text: post.text.replaceAll("\n", "\\n") })),
    };
    const more = offset + page.posts.length < page.total;
    return `${formatPostList(page, result.newPostIds, offset, now, preview)}\nComplete: ${!more}${more ? ` · Next offset: ${offset + page.posts.length}` : ""}\nNext cursor: ${initialWallCursor(swarmId)} (delta history starts at the beginning)`;
  }
  // Validate the original count before imposing the smaller overview output bound.
  const requested = input.count ?? PAGE_DEFAULT_COUNT;
  const delta = readWallDeltaAs(db, swarmId, reader, input.after, requested);
  const visible = delta.changes.slice(0, OVERVIEW_ITEMS);
  const complete = visible.filter((change) => !change.truncated && Array.from(change.text).length <= OVERVIEW_CHARS);
  markPostsCovered(
    db,
    swarmId,
    reader,
    complete.filter((change) => change.kind === "post").map((change) => change.id),
  );
  markCommentsCovered(
    db,
    swarmId,
    reader,
    complete.filter((change) => change.kind === "comment").map((change) => change.id),
  );
  const lines = visible.map((change) => {
    const label =
      change.kind === "post"
        ? `Post #${change.id}: ${change.title}`
        : `Comment #${change.id} on post #${change.postId}`;
    const text = Array.from(change.text).slice(0, OVERVIEW_CHARS).join("").replaceAll("\n", "\\n");
    return `${label} · ${change.author}: ${text}${change.truncated || text.length < change.text.length ? ` … (read post #${change.postId} for full text)` : ""}`;
  });
  if (lines.length === 0) lines.push("No wall changes.");
  const hasMore = delta.hasMore || visible.length < delta.changes.length;
  const next = visible.at(-1);
  lines.push(`Complete: ${!hasMore}`);
  lines.push(
    `Next cursor: ${next === undefined ? delta.nextCursor : encodeWallCursor(swarmId, next.revision)}${hasMore ? " (more changes)" : ""}`,
  );
  return lines.join("\n");
}

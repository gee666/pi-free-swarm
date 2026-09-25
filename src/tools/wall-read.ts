import { initialWallCursor, readWallDeltaAs } from "../broker/wall-delta.js";
import { readPostsAs } from "../broker/wall.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { formatPostList } from "./agent-tool-format.js";

/** Shared execution helper; registration keeps the existing history parameters optional. */
export function readWallTool(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  input: { count?: number; offset?: number; after?: string },
  now: number,
): string {
  if (input.after === undefined) {
    const count = input.count ?? PAGE_DEFAULT_COUNT;
    const offset = input.offset ?? 0;
    const result = readPostsAs(db, swarmId, reader, { count, offset });
    return `${formatPostList(result.page, result.newPostIds, offset, now)}\nNext cursor: ${initialWallCursor(swarmId)} (delta history starts at the beginning)`;
  }
  const delta = readWallDeltaAs(db, swarmId, reader, input.after, input.count);
  const lines = delta.changes.map((change) => {
    const label =
      change.kind === "post"
        ? `Post #${change.id}: ${change.title}`
        : `Comment #${change.id} on post #${change.postId}`;
    return `${label} · ${change.author}: ${change.text}${change.truncated ? ` … (read post #${change.postId} for full text)` : ""}`;
  });
  if (lines.length === 0) lines.push("No wall changes.");
  lines.push(`Next cursor: ${delta.nextCursor}${delta.hasMore ? " (more changes)" : ""}`);
  return lines.join("\n");
}

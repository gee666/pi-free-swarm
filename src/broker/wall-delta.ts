import { Buffer } from "node:buffer";
import { PAGE_DEFAULT_COUNT, PAGE_MAX_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { bodyCeiling } from "../limits.js";
import { int, text as str } from "../store/rows.js";
import { bodyLimit } from "./body-limit.js";
import { BrokerError } from "./errors.js";
import { requireParticipant, requireSwarm } from "./validate.js";

export const WALL_DELTA_MAX = PAGE_MAX_COUNT;

/** Stored bodies fit the ceiling, so only rows written under a larger setting are cut in lists. */
export function wallPreviewChars(db: SwarmDb): number {
  return bodyCeiling(bodyLimit(db));
}

export interface WallChange {
  revision: number;
  kind: "post" | "comment";
  id: number;
  postId: number;
  author: string;
  title: string;
  text: string;
  truncated: boolean;
  createdAt: number;
}

export interface WallDelta {
  changes: WallChange[];
  nextCursor: string;
  hasMore: boolean;
}

/** Start at the beginning, independently of legacy read marks or the newest history page. */
export function initialWallCursor(swarmId: number): string {
  return encodeCursor(swarmId, 0);
}

function encodeCursor(swarmId: number, revision: number): string {
  return Buffer.from(`wall:1:${swarmId}:${revision}`).toString("base64url");
}

function decodeCursor(cursor: string, swarmId: number): number {
  if (cursor.length <= 128) {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^wall:1:([1-9]\d*):(0|[1-9]\d*)$/.exec(decoded);
    if (match !== null) {
      const revision = Number(match[2]);
      if (
        Number(match[1]) === swarmId &&
        Number.isSafeInteger(revision) &&
        encodeCursor(swarmId, revision) === cursor
      ) {
        return revision;
      }
    }
  }
  throw new BrokerError("validation", "Invalid wall cursor for this swarm.", "after");
}

/** One write-locked snapshot; only returned revisions are consumed. No reader state is changed. */
export function readWallDeltaAs(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  after: string,
  count = PAGE_DEFAULT_COUNT,
): WallDelta {
  if (!Number.isInteger(count) || count < 1 || count > WALL_DELTA_MAX) {
    throw new BrokerError("validation", `count must be between 1 and ${WALL_DELTA_MAX}.`, "count");
  }
  const revision = decodeCursor(after, swarmId);
  const preview = wallPreviewChars(db);
  return db.write(() => {
    requireSwarm(db, swarmId);
    requireParticipant(db, swarmId, reader);
    const rows = db.sql
      .prepare(
        `
      SELECT w.revision, w.kind, w.item_id, COALESCE(p.id, c.post_id) AS post_id,
        COALESCE(p.author, c.author) AS author, COALESCE(p.title, '') AS title,
        substr(COALESCE(p.body, c.body), 1, ?) AS body,
        length(COALESCE(p.body, c.body)) AS body_length,
        COALESCE(p.created_at, c.created_at) AS created_at
      FROM wall_changes w
      LEFT JOIN posts p ON w.kind = 'post' AND p.id = w.item_id
      LEFT JOIN comments c ON w.kind = 'comment' AND c.id = w.item_id
      WHERE w.swarm_id = ? AND w.revision > ?
      ORDER BY w.revision LIMIT ?
    `,
      )
      .all(preview, swarmId, revision, count + 1);
    const changes = rows.slice(0, count).map((row): WallChange => ({
      revision: int(row, "revision"),
      kind: str(row, "kind") === "post" ? "post" : "comment",
      id: int(row, "item_id"),
      postId: int(row, "post_id"),
      author: str(row, "author"),
      title: str(row, "title"),
      text: str(row, "body"),
      truncated: int(row, "body_length") > preview,
      createdAt: int(row, "created_at"),
    }));
    return {
      changes,
      nextCursor: encodeCursor(swarmId, changes.at(-1)?.revision ?? revision),
      hasMore: rows.length > count,
    };
  });
}

import { SYSTEM_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { jsonList, text } from "../store/rows.js";
import { createThread, insertMessage } from "./message-insert.js";

interface WallMention {
  postId: number;
  commentId?: number;
  author: string;
  text: string;
  mentionText: string;
}

/** Mentions are independent inbox messages, not cancellable subscription notifications. */
export function notifyWallMentions(db: SwarmDb, swarmId: number, source: WallMention, now: number): string[] {
  const names = new Set(
    Array.from(source.mentionText.matchAll(/(?<![\p{L}\p{N}_@])@([A-Za-z]+)(?![\p{L}\p{N}_])/gu), (match) =>
      match[1].toLowerCase(),
    ),
  );
  if (names.size === 0) return [];
  const recipients = db.sql
    .prepare(
      `SELECT p.name FROM participants p
       WHERE p.swarm_id = ? AND p.kind = 'agent' AND p.retired_at IS NULL AND p.name != ?
         AND lower(p.name) IN (SELECT value FROM json_each(?))`,
    )
    .all(swarmId, source.author, jsonList([...names]))
    .map((row) => text(row, "name"));
  if (recipients.length === 0) return [];
  const threadId = createThread(db, swarmId, [SYSTEM_NAME, ...recipients], now);
  const location =
    source.commentId === undefined
      ? `post #${source.postId}`
      : `comment #${source.commentId} on post #${source.postId}`;
  insertMessage(db, {
    swarmId,
    threadId,
    sender: SYSTEM_NAME,
    text: `Mention in ${location} by ${source.author}:\n${source.text}`,
    recipients: recipients.map((name) => ({ name, status: "pending" })),
    now,
  });
  return recipients;
}

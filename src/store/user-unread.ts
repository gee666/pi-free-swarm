import type { UserUnreadSummary } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";

export const USER_ATTENTION_COUNT_SQL = `
  (SELECT COUNT(*) FROM user_comment_attention a
    LEFT JOIN post_subscriptions s ON s.swarm_id = a.swarm_id AND s.post_id = a.post_id AND s.name = '${USER_NAME}'
    WHERE a.swarm_id = ? AND a.read_at IS NULL AND (a.mentioned = 1 OR s.subscribed = 1)) +
  (SELECT COUNT(*) FROM user_post_attention WHERE swarm_id = ? AND read_at IS NULL)`;

export function userUnreadState(db: SwarmDb, swarmId: number): { total: number; summary: UserUnreadSummary } {
  const attention = db.sql.prepare(`SELECT ${USER_ATTENTION_COUNT_SQL} AS unread`).get(swarmId, swarmId);
  const total = attention ? int(attention, "unread") : 0;
  return { total, summary: { messages: 0, comments: total } };
}

export function userMentionCount(db: SwarmDb, swarmId: number): number {
  const row = db.sql
    .prepare(
      `SELECT
    (SELECT count(*) FROM user_post_attention WHERE swarm_id = ? AND read_at IS NULL) +
    (SELECT count(*) FROM user_comment_attention WHERE swarm_id = ? AND read_at IS NULL AND mentioned = 1) AS mentions`,
    )
    .get(swarmId, swarmId);
  return row === undefined ? 0 : int(row, "mentions");
}

export function userUnreadSummary(db: SwarmDb, swarmId: number): UserUnreadSummary {
  return userUnreadState(db, swarmId).summary;
}

import type { UserUnreadSummary } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";

/** Keep legacy inbox totals separate from subscription-filtered Wall attention. */
export function userUnreadState(db: SwarmDb, swarmId: number): { total: number; summary: UserUnreadSummary } {
  const row = db.sql
    .prepare(
      `SELECT COUNT(*) AS total,
    COALESCE(SUM(n.message_id IS NULL), 0) AS messages,
    COALESCE(SUM(n.message_id IS NOT NULL AND s.subscribed = 1), 0) AS comments
    FROM message_recipients r LEFT JOIN comment_notifications n ON n.message_id = r.message_id
    LEFT JOIN post_subscriptions s ON s.swarm_id = r.swarm_id AND s.post_id = n.post_id AND s.name = r.name
    WHERE r.swarm_id = ? AND r.name = ? AND r.status IN ('pending', 'delivered')`,
    )
    .get(swarmId, USER_NAME);
  return row
    ? { total: int(row, "total"), summary: { messages: int(row, "messages"), comments: int(row, "comments") } }
    : { total: 0, summary: { messages: 0, comments: 0 } };
}

export function userUnreadSummary(db: SwarmDb, swarmId: number): UserUnreadSummary {
  return userUnreadState(db, swarmId).summary;
}

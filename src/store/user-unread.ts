import type { UserUnreadSummary } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";

/** Legacy inbox history remains separate from subscription-filtered Wall attention. */
export function userUnreadState(db: SwarmDb, swarmId: number): { total: number; summary: UserUnreadSummary } {
  const inbox = db.sql
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(n.message_id IS NULL), 0) AS messages
    FROM message_recipients r LEFT JOIN comment_notifications n ON n.message_id = r.message_id
    WHERE r.swarm_id = ? AND r.name = ? AND r.status IN ('pending', 'delivered')`,
    )
    .get(swarmId, USER_NAME);
  const attention = db.sql
    .prepare(
      `SELECT COUNT(*) AS comments FROM user_comment_attention a
    JOIN post_subscriptions s ON s.swarm_id = a.swarm_id AND s.post_id = a.post_id AND s.name = ?
    WHERE a.swarm_id = ? AND a.read_at IS NULL AND s.subscribed = 1`,
    )
    .get(USER_NAME, swarmId);
  return {
    total: inbox ? int(inbox, "total") : 0,
    summary: { messages: inbox ? int(inbox, "messages") : 0, comments: attention ? int(attention, "comments") : 0 },
  };
}

export function userUnreadSummary(db: SwarmDb, swarmId: number): UserUnreadSummary {
  return userUnreadState(db, swarmId).summary;
}

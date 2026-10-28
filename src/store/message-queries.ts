import type { MessageView, RecipientView, UnreadCounts } from "../api-types.js";
import { SYSTEM_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { int, jsonList, kindOf, recipientOf, recipientStatusOf, text } from "./rows.js";

const IN_IDS = "IN (SELECT value FROM json_each(?))";
const OPEN = "('pending', 'delivered')";

/** In id order; unknown ids are skipped. */
export function getMessages(db: SwarmDb, messageIds: readonly number[]): MessageView[] {
  if (messageIds.length === 0) return [];
  const ids = jsonList(messageIds);
  const recipients = new Map<number, RecipientView[]>();
  for (const row of db.sql
    .prepare(`SELECT * FROM message_recipients WHERE message_id ${IN_IDS} ORDER BY message_id, position`)
    .all(ids)) {
    const id = int(row, "message_id");
    const list = recipients.get(id) ?? [];
    list.push(recipientOf(row));
    recipients.set(id, list);
  }
  return db.sql
    .prepare(
      `SELECT m.*, p.kind AS sender_kind FROM messages m
       JOIN participants p ON p.swarm_id = m.swarm_id AND p.name = m.sender
       WHERE m.id ${IN_IDS} ORDER BY m.id`,
    )
    .all(ids)
    .map((row) => ({
      id: int(row, "id"),
      swarmId: int(row, "swarm_id"),
      threadId: int(row, "thread_id"),
      sender: text(row, "sender"),
      senderKind: kindOf(row, "sender_kind"),
      text: text(row, "body"),
      createdAt: int(row, "created_at"),
      recipients: recipients.get(int(row, "id")) ?? [],
    }));
}

function unreadOf(db: SwarmDb, swarmId: number, name: string): number {
  const row = db.sql
    .prepare(`SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = ? AND status IN ${OPEN}`)
    .get(swarmId, name);
  return row === undefined ? 0 : int(row, "n");
}

/** Pending or delivered inbox rows per name (the badge value). */
export function unreadCounts(db: SwarmDb, swarmId: number, names: readonly string[]): UnreadCounts {
  const counts: UnreadCounts = {};
  for (const name of names) counts[name] = unreadOf(db, swarmId, name);
  return counts;
}

export interface OpenRecipient {
  messageId: number;
  name: string;
  status: "pending" | "delivered";
}

/** Agent recipients not yet read, in message id order. User rows are excluded (they are never "open" work). */
export function listOpenAgentRecipients(db: SwarmDb, swarmId: number): OpenRecipient[] {
  const rows = db.sql
    .prepare(
      `SELECT r.message_id, r.name, r.status FROM message_recipients r
       JOIN participants p ON p.swarm_id = r.swarm_id AND p.name = r.name
       JOIN messages m ON m.id = r.message_id
       WHERE r.swarm_id = ? AND r.status IN ${OPEN} AND p.kind = 'agent' AND m.sender = ?
       ORDER BY r.message_id, r.position`,
    )
    .all(swarmId, SYSTEM_NAME);
  return rows.flatMap((row): OpenRecipient[] => {
    const status = recipientStatusOf(row);
    if (status !== "pending" && status !== "delivered") return [];
    return [{ messageId: int(row, "message_id"), name: text(row, "name"), status }];
  });
}

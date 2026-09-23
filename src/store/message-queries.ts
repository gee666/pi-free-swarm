// Read side of threads, messages and mailboxes.
import type {
  MailboxKind,
  MailboxResponse,
  MailboxThread,
  MessageView,
  RecipientView,
  ThreadResponse,
  ThreadView,
  UnreadCounts,
} from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { int, jsonList, kindOf, recipientOf, recipientStatusOf, text, type Row } from "./rows.js";
import { findParticipant } from "./swarm-queries.js";

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

function ids(rows: Row[], key = "id"): number[] {
  return rows.map((row) => int(row, key));
}

function threadOf(db: SwarmDb, row: Row): ThreadView {
  const id = int(row, "id");
  const members = db.sql
    .prepare("SELECT name FROM thread_members WHERE thread_id = ? ORDER BY position")
    .all(id)
    .map((member) => text(member, "name"));
  return {
    id,
    swarmId: int(row, "swarm_id"),
    createdBy: text(row, "created_by"),
    createdAt: int(row, "created_at"),
    members,
  };
}

export function getThreadView(db: SwarmDb, swarmId: number, threadId: number): ThreadView | null {
  const row = db.sql.prepare("SELECT * FROM threads WHERE id = ? AND swarm_id = ?").get(threadId, swarmId);
  return row === undefined ? null : threadOf(db, row);
}

/** Messages oldest first; `null` when the thread is missing or belongs to another swarm. */
export function getThread(db: SwarmDb, swarmId: number, threadId: number): ThreadResponse | null {
  const thread = getThreadView(db, swarmId, threadId);
  if (thread === null) return null;
  const messageIds = ids(db.sql.prepare("SELECT id FROM messages WHERE thread_id = ? ORDER BY id").all(threadId));
  return { thread, messages: getMessages(db, messageIds) };
}

function unreadOf(db: SwarmDb, swarmId: number, name: string, threadId?: number): number {
  const row =
    threadId === undefined
      ? db.sql
          .prepare(`SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ? AND name = ? AND status IN ${OPEN}`)
          .get(swarmId, name)
      : db.sql
          .prepare(
            `SELECT COUNT(*) AS n FROM message_recipients r JOIN messages m ON m.id = r.message_id
             WHERE r.swarm_id = ? AND r.name = ? AND r.status IN ${OPEN} AND m.thread_id = ?`,
          )
          .get(swarmId, name, threadId);
  return row === undefined ? 0 : int(row, "n");
}

/** Pending or delivered inbox rows per name (the badge value). */
export function unreadCounts(db: SwarmDb, swarmId: number, names: readonly string[]): UnreadCounts {
  const counts: UnreadCounts = {};
  for (const name of names) counts[name] = unreadOf(db, swarmId, name);
  return counts;
}

/** Threads with messages in the box, by their latest such message, newest first. */
export function getMailbox(
  db: SwarmDb,
  swarmId: number,
  name: string,
  box: MailboxKind,
  page: { count: number; offset: number },
): MailboxResponse {
  const canonical = findParticipant(db, swarmId, name)?.name ?? name;
  const inBox =
    box === "inbox"
      ? "FROM messages m JOIN message_recipients r ON r.message_id = m.id WHERE r.swarm_id = ? AND r.name = ?"
      : "FROM messages m WHERE m.swarm_id = ? AND m.sender = ?";
  const threadRows = db.sql
    .prepare(
      `SELECT m.thread_id, MAX(m.id) AS last_id, MAX(m.created_at) AS last_at ${inBox}
       GROUP BY m.thread_id ORDER BY last_at DESC, last_id DESC LIMIT ? OFFSET ?`,
    )
    .all(swarmId, canonical, page.count, page.offset);
  const threads: MailboxThread[] = [];
  for (const row of threadRows) {
    const threadId = int(row, "thread_id");
    const thread = getThreadView(db, swarmId, threadId);
    if (thread === null) continue;
    const messageIds = ids(
      db.sql.prepare(`SELECT m.id ${inBox} AND m.thread_id = ? ORDER BY m.id`).all(swarmId, canonical, threadId),
    );
    threads.push({
      thread,
      messages: getMessages(db, messageIds),
      unread: box === "inbox" ? unreadOf(db, swarmId, canonical, threadId) : 0,
      lastMessageAt: int(row, "last_at"),
    });
  }
  const total = db.sql.prepare(`SELECT COUNT(DISTINCT m.thread_id) AS n ${inBox}`).get(swarmId, canonical);
  return {
    name: canonical,
    box,
    threads,
    total: total === undefined ? 0 : int(total, "n"),
    unread: unreadOf(db, swarmId, canonical),
  };
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
       WHERE r.swarm_id = ? AND r.status IN ${OPEN} AND p.kind = 'agent'
       ORDER BY r.message_id, r.position`,
    )
    .all(swarmId);
  return rows.flatMap((row): OpenRecipient[] => {
    const status = recipientStatusOf(row);
    if (status !== "pending" && status !== "delivered") return [];
    return [{ messageId: int(row, "message_id"), name: text(row, "name"), status }];
  });
}

/** Messages addressed to `name` with id > `afterMessageId`, in id order. */
export function listInboxAfter(db: SwarmDb, swarmId: number, name: string, afterMessageId: number): MessageView[] {
  const messageIds = ids(
    db.sql
      .prepare(
        "SELECT message_id FROM message_recipients WHERE swarm_id = ? AND name = ? AND message_id > ? ORDER BY message_id",
      )
      .all(swarmId, name, afterMessageId),
    "message_id",
  );
  return getMessages(db, messageIds);
}

import { BrokerError } from "../broker/errors.js";
import { checkPage, requireParticipant, requireSwarm } from "../broker/validate.js";
import { PAGE_DEFAULT_COUNT, WATCHER_NAME } from "../constants.js";
import { coverCommentNotifications } from "../broker/subscriptions.js";
import type { SwarmDb } from "../store/db.js";
import { getMessages, getThreadView } from "../store/message-queries.js";
import { int } from "../store/rows.js";
import { timeAgo } from "../wall-format.js";
import { readPosition, renderReadPage } from "./read-page.js";

/** Authorization happens before bounded message retrieval, without loading the full thread. */
export function readThreadTool(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  input: { thread_id: number; count?: number; after?: string },
  now = Date.now(),
  access: "member" | "watcher" = "member",
): string {
  const count = input.count ?? PAGE_DEFAULT_COUNT;
  checkPage({ count, offset: 0 });
  requireSwarm(db, swarmId);
  const participant = requireParticipant(db, swarmId, reader);
  const thread = getThreadView(db, swarmId, input.thread_id);
  if (thread === null) throw new BrokerError("not_found", `Thread #${input.thread_id} not found.`);
  if (!thread.members.includes(participant.name) && !(access === "watcher" && participant.name === WATCHER_NAME))
    throw new BrokerError("not_member", `You are not a member of thread #${thread.id}.`);
  const row = db.sql.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE thread_id = ?").get(thread.id);
  const position = readPosition(input.after, `thread:${swarmId}:${thread.id}`, row === undefined ? 0 : int(row, "id"));
  const rows = db.sql
    .prepare("SELECT id FROM messages WHERE thread_id = ? AND id >= ? AND id <= ? ORDER BY id LIMIT ?")
    .all(thread.id, position.id, position.snapshot, count + 1);
  const items = getMessages(
    db,
    rows.map((item) => int(item, "id")),
  ).map((message) => ({
    id: message.id,
    label: `#${message.id} ${message.sender === reader ? "You" : message.sender} → ${message.recipients.map((recipient) => (recipient.name === reader ? "You" : recipient.name)).join(", ")} · ${timeAgo(message.createdAt, now)}`,
    text: message.text,
  }));
  const page = renderReadPage(`Thread #${thread.id} · members: ${thread.members.join(", ")}`, items, position, count);
  coverCommentNotifications(db, swarmId, reader, page.completeIds, true);
  return page.text;
}

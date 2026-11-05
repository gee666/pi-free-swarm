import { randomUUID } from "node:crypto";
import type { WatcherChatResponse, WatcherChatMessage } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { insertEvent } from "./events.js";
import { int, text } from "./rows.js";

export function readWatcherChat(db: SwarmDb, swarmId: number): WatcherChatResponse {
  return db.read(() => {
    const row = db.sql.prepare("SELECT * FROM watcher_chat_sessions WHERE swarm_id = ? AND active = 1").get(swarmId);
    if (!row) return { sessionId: null, messages: [], status: "idle", error: null };
    const sessionId = text(row, "id");
    const status = text(row, "status");
    if (status !== "idle" && status !== "working" && status !== "error") throw new Error("Invalid Watcher chat status");
    const messages = db.sql
      .prepare("SELECT * FROM watcher_chat_messages WHERE session_id = ? ORDER BY sequence")
      .all(sessionId)
      .map((message): WatcherChatMessage => {
        const role = text(message, "role");
        if (role !== "user" && role !== "assistant") throw new Error("Invalid Watcher chat role");
        return { id: text(message, "id"), role, text: text(message, "text"), createdAt: int(message, "created_at") };
      });
    return { sessionId, messages, status, error: typeof row.error === "string" ? row.error : null };
  });
}

export function createWatcherChat(db: SwarmDb, swarmId: number, id: string, now: number): void {
  db.write(() => {
    db.sql.prepare("UPDATE watcher_chat_sessions SET active = 0 WHERE swarm_id = ? AND active = 1").run(swarmId);
    db.sql
      .prepare("INSERT INTO watcher_chat_sessions (id, swarm_id, created_at) VALUES (?, ?, ?)")
      .run(id, swarmId, now);
    updated(db, swarmId, now);
  });
}

export function setWatcherChatStatus(
  db: SwarmDb,
  swarmId: number,
  id: string,
  status: WatcherChatResponse["status"],
  error: string | null,
  now: number,
): void {
  db.write(() => {
    const changed = db.sql
      .prepare("UPDATE watcher_chat_sessions SET status = ?, error = ? WHERE id = ? AND active = 1 AND swarm_id = ?")
      .run(status, error, id, swarmId);
    if (Number(changed.changes) > 0) updated(db, swarmId, now);
  });
}

export function appendWatcherChat(
  db: SwarmDb,
  swarmId: number,
  id: string,
  role: WatcherChatMessage["role"],
  body: string,
  now: number,
): void {
  db.write(() => {
    const changed = db.sql
      .prepare(
        `INSERT INTO watcher_chat_messages (id, session_id, role, text, created_at)
      SELECT ?, id, ?, ?, ? FROM watcher_chat_sessions WHERE id = ? AND swarm_id = ? AND active = 1`,
      )
      .run(randomUUID(), role, body, now, id, swarmId);
    if (Number(changed.changes) > 0) updated(db, swarmId, now);
  });
}

export function interruptWatcherChats(db: SwarmDb, now: number): void {
  db.write(() => {
    const rows = db.sql
      .prepare("SELECT swarm_id, id FROM watcher_chat_sessions WHERE active = 1 AND status = 'working'")
      .all();
    for (const row of rows)
      setWatcherChatStatus(
        db,
        int(row, "swarm_id"),
        text(row, "id"),
        "error",
        "Board host stopped before the Watcher response completed. Send again or start a new chat.",
        now,
      );
  });
}

function updated(db: SwarmDb, swarmId: number, now: number): void {
  insertEvent(db, swarmId, "watcher.chat.updated", { swarmId }, now);
}

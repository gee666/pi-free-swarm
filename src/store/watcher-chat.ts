import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";

export function watcherChatPostId(db: SwarmDb, swarmId: number): number | undefined {
  const row = db.sql.prepare("SELECT post_id FROM watcher_chats WHERE swarm_id = ?").get(swarmId);
  return row === undefined ? undefined : int(row, "post_id");
}

export function saveWatcherChatPost(db: SwarmDb, swarmId: number, postId: number): void {
  db.sql.prepare("INSERT INTO watcher_chats (swarm_id, post_id) VALUES (?, ?)").run(swarmId, postId);
}

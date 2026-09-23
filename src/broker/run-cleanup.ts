// The end of a run, shared by endRun and the stale-lock sweep: close the spans, release the lock, and
// make every message that can no longer reach its agent `undeliverable` (pi's queue died with it).
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { listOpenAgentRecipients } from "../store/message-queries.js";
import { count, int, jsonList, text, textOrNull } from "../store/rows.js";
import { emitParticipantUpdated, emitRecipientStatus, emitSwarmUpdated } from "./emit.js";
import { addUndeliverableReply } from "./message-insert.js";

export type RunEndStatus = "finished" | "stopped" | "interrupted";

export function cleanupRun(db: SwarmDb, swarmId: number, end: RunEndStatus, now: number): void {
  db.write(() => {
    const before = new Map(
      db.sql
        .prepare("SELECT name, status, activity FROM participants WHERE swarm_id = ? AND kind = 'agent'")
        .all(swarmId)
        .map((row) => [text(row, "name"), `${text(row, "status")}|${textOrNull(row, "activity")}`]),
    );
    db.sql
      .prepare(
        "UPDATE swarms SET status = ?, finished_at = ?, runner_pid = NULL, runner_heartbeat_at = NULL WHERE id = ?",
      )
      .run(end, now, swarmId);
    db.sql
      .prepare("UPDATE swarm_runs SET ended_at = ?, end_status = ? WHERE swarm_id = ? AND ended_at IS NULL")
      .run(now, end, swarmId);
    db.sql
      .prepare("UPDATE agent_runs SET ended_at = ?, reason = 'stopped' WHERE swarm_id = ? AND ended_at IS NULL")
      .run(now, swarmId);
    // A finished swarm keeps idle/crashed; a stopped or interrupted one stops everything but crashed agents.
    db.sql
      .prepare(
        `UPDATE participants SET activity = NULL,
           status = CASE WHEN ? <> 'finished' AND status <> 'crashed' THEN 'stopped' ELSE status END
         WHERE swarm_id = ? AND kind = 'agent'`,
      )
      .run(end, swarmId);
    for (const row of db.sql
      .prepare("SELECT name, status, activity FROM participants WHERE swarm_id = ? AND kind = 'agent'")
      .all(swarmId)) {
      const name = text(row, "name");
      if (before.get(name) !== `${text(row, "status")}|${textOrNull(row, "activity")}`) {
        emitParticipantUpdated(db, swarmId, name, now);
      }
    }
    abandonOpenMessages(db, swarmId, now);
    emitSwarmUpdated(db, swarmId, now);
  });
}

function abandonOpenMessages(db: SwarmDb, swarmId: number, now: number): void {
  const update = db.sql.prepare(
    `UPDATE message_recipients SET status = 'undeliverable'
     WHERE message_id = ? AND name = ? AND status IN ('pending', 'delivered')`,
  );
  const affected = new Set<number>();
  for (const open of listOpenAgentRecipients(db, swarmId)) {
    if (count(update.run(open.messageId, open.name).changes) === 0) continue;
    affected.add(open.messageId);
    emitRecipientStatus(db, swarmId, open.messageId, open.name, now);
  }
  if (affected.size === 0) return;
  // Agents are gone; only the User, who can still read the board, gets told.
  const threads = db.sql
    .prepare(
      `SELECT DISTINCT thread_id FROM messages
       WHERE id IN (SELECT value FROM json_each(?)) AND sender = ? ORDER BY thread_id`,
    )
    .all(jsonList([...affected]), USER_NAME);
  for (const row of threads) {
    addUndeliverableReply(db, swarmId, int(row, "thread_id"), { name: USER_NAME, kind: "user" }, now);
  }
}

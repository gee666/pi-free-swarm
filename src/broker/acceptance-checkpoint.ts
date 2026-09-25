import { SYSTEM_NAME } from "../constants.js";
import { getAcceptance } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { text } from "../store/rows.js";
import { acceptanceRun } from "./acceptance.js";
import { createThread, insertMessage } from "./message-insert.js";
import { notifyLocalMessage } from "./notify.js";

export const PENDING_ACCEPTANCE_NOTICE =
  "Task acceptance is pending. swarm_acceptance can inspect the original task and shared evidence; any peer may self-claim or decline. This is the run's only automatic checkpoint notice.";

/** Call once at quiescence before sealing. Durable run key also bounds duplicate/cross-process calls. */
export function notifyPendingAcceptance(
  db: SwarmDb,
  swarmId: number,
  run: number,
  availableAgents: readonly string[],
  now: number,
): { recipient: string; revision: number } | null {
  const result = queuePendingAcceptance(db, swarmId, run, availableAgents, now);
  if (result) notifyLocalMessage(swarmId);
  return result;
}

/** Transaction-only variant for composing the checkpoint with the completion guard. */
export function queuePendingAcceptance(
  db: SwarmDb,
  swarmId: number,
  run: number,
  availableAgents: readonly string[],
  now: number,
): { recipient: string; revision: number } | null {
  return db.write(() => {
    // An explicit stop or stale runner must not enqueue a checkpoint.
    const swarm = db.sql.prepare("SELECT status, run_count FROM swarms WHERE id = ?").get(swarmId);
    if (!swarm || swarm.run_count !== run || !["starting", "running"].includes(String(swarm.status))) return null;
    const closed = db.sql.prepare("SELECT closed_run FROM acceptance WHERE swarm_id = ?").get(swarmId);
    if (closed?.closed_run === run) return null;
    if (acceptanceRun(db, swarmId) !== run) return null;
    const record = getAcceptance(db, swarmId);
    if (record.verdict !== "unchecked" && record.verdict !== "checking") return null;
    if (db.sql.prepare("SELECT 1 FROM acceptance_notifications WHERE swarm_id = ? AND run = ?").get(swarmId, run))
      return null;
    const available = new Set(availableAgents.map((name) => name.toLowerCase()));
    const peers = db.sql
      .prepare(
        `SELECT name FROM participants WHERE swarm_id = ? AND kind = 'agent'
      AND status = 'idle' ORDER BY launch_order, name`,
      )
      .all(swarmId)
      .map((row) => text(row, "name"))
      .filter((name) => available.has(name.toLowerCase()));
    const recipient = peers[(run - 1) % peers.length];
    if (!recipient) return null;
    db.sql
      .prepare(
        `INSERT INTO acceptance_notifications (swarm_id, run, recipient, revision, created_at)
      VALUES (?, ?, ?, ?, ?)`,
      )
      .run(swarmId, run, recipient, record.revision, now);
    const threadId = createThread(db, swarmId, [SYSTEM_NAME, recipient], now);
    insertMessage(db, {
      swarmId,
      threadId,
      sender: SYSTEM_NAME,
      text: PENDING_ACCEPTANCE_NOTICE,
      recipients: [{ name: recipient, status: "pending" }],
      now,
    });
    return { recipient, revision: record.revision };
  });
}

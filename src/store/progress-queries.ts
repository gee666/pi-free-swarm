import type { ParticipantStatus, SwarmStatus } from "../api-types.js";
import { WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { agentStatusOf, int, intOrNull, text } from "./rows.js";
import { swarmUsageTotals } from "./scalar-totals.js";
import { USER_ATTENTION_COUNT_SQL } from "./user-unread.js";
import { resolvedSwarmState } from "./swarm-status.js";

export interface ProgressSnapshot {
  name: string;
  run: number;
  status: SwarmStatus;
  startedAt: number | null;
  finishedAt: number | null;
  agents: Record<ParticipantStatus, number>;
  posts: number;
  messages: number;
  unreadForUser: number;
  cost: number;
  tokens: number;
}

/** A fixed number of scalar/grouped reads, independent of archived participant metadata. */
export function getProgressSnapshot(db: SwarmDb, swarmId: number, now: number): ProgressSnapshot | null {
  const row = db.sql
    .prepare(
      "SELECT name,run_count,status,runner_pid,runner_heartbeat_at,started_at,finished_at FROM swarms WHERE id = ?",
    )
    .get(swarmId);
  if (!row) return null;
  const agents: Record<ParticipantStatus, number> = {
    pending: 0,
    starting: 0,
    working: 0,
    idle: 0,
    crashed: 0,
    stopped: 0,
    retired: 0,
  };
  const statuses = db.sql
    .prepare(
      `SELECT status, MAX(retired_at) AS retired_at, COUNT(*) AS n FROM participants
     WHERE swarm_id = ? AND kind = 'agent' AND name <> ?
     GROUP BY status, retired_at IS NOT NULL`,
    )
    .all(swarmId, WATCHER_NAME);
  for (const status of statuses) agents[agentStatusOf(status)] += int(status, "n");
  const totals = db.sql
    .prepare(
      `SELECT
      (SELECT COUNT(*) FROM posts WHERE swarm_id = ?) AS posts,
      (SELECT COUNT(*) FROM messages WHERE swarm_id = ?) AS messages,
      ${USER_ATTENTION_COUNT_SQL} AS unread`,
    )
    .get(swarmId, swarmId, swarmId, swarmId);
  const usage = swarmUsageTotals(db, swarmId);
  return {
    name: text(row, "name"),
    run: int(row, "run_count"),
    status: resolvedSwarmState(row, now).status,
    startedAt: intOrNull(row, "started_at"),
    finishedAt: intOrNull(row, "finished_at"),
    agents,
    posts: totals ? int(totals, "posts") : 0,
    messages: totals ? int(totals, "messages") : 0,
    unreadForUser: totals ? int(totals, "unread") : 0,
    cost: usage.costUsd,
    tokens: usage.tokens,
  };
}

// Read side of swarms and participants. Swarm status is resolved on read: a live status with a stale run
// lock is reported as `interrupted` until the next sweep writes it.
import path from "node:path";
import type { ParticipantKind, ParticipantView, SwarmListItem } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { isPidAlive, isRunLockFresh, type PidAlive } from "./locks.js";
import { activityOf, agentStatusOf, int, intOrNull, kindOf, real, swarmStatusOf, text, type Row } from "./rows.js";

const SWARM_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM participants p
      WHERE p.swarm_id = s.id AND p.kind = 'agent' AND p.status = 'working') AS agents_working
  FROM swarms s`;

function swarmOf(row: Row, now: number, alive: PidAlive): SwarmListItem {
  const stored = swarmStatusOf(row);
  const runnerPid = intOrNull(row, "runner_pid");
  const wantsLive = stored === "starting" || stored === "running";
  const live =
    wantsLive && isRunLockFresh({ runnerPid, runnerHeartbeatAt: intOrNull(row, "runner_heartbeat_at") }, now, alive);
  return {
    id: int(row, "id"),
    name: text(row, "name"),
    taskPrompt: text(row, "task_prompt"),
    status: wantsLive && !live ? "interrupted" : stored,
    acceptsMessages: live,
    agentAmount: int(row, "agent_amount"),
    agentsWorking: live ? int(row, "agents_working") : 0,
    runCount: int(row, "run_count"),
    runnerPid: live ? runnerPid : null,
    createdAt: int(row, "created_at"),
    startedAt: intOrNull(row, "started_at"),
    finishedAt: intOrNull(row, "finished_at"),
  };
}

/** Newest first. */
export function listSwarms(db: SwarmDb, now: number, alive: PidAlive = isPidAlive): SwarmListItem[] {
  return db.sql
    .prepare(`${SWARM_SELECT} ORDER BY s.id DESC`)
    .all()
    .map((row) => swarmOf(row, now, alive));
}

export function getSwarm(
  db: SwarmDb,
  swarmId: number,
  now: number,
  alive: PidAlive = isPidAlive,
): SwarmListItem | null {
  const row = db.sql.prepare(`${SWARM_SELECT} WHERE s.id = ?`).get(swarmId);
  return row === undefined ? null : swarmOf(row, now, alive);
}

const PARTICIPANT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM message_recipients r
      WHERE r.swarm_id = p.swarm_id AND r.name = p.name AND r.status IN ('pending', 'delivered')) AS unread,
    (SELECT COALESCE(SUM(u.cost), 0) FROM usage u WHERE u.swarm_id = p.swarm_id AND u.agent = p.name) AS cost
  FROM participants p`;

function participantOf(row: Row): ParticipantView | null {
  const kind = kindOf(row);
  const common = {
    unread: int(row, "unread"),
    joinedAt: intOrNull(row, "joined_at"),
    lastActivityAt: intOrNull(row, "last_activity_at"),
  };
  if (kind === "user") return { kind, name: USER_NAME, ...common };
  if (kind !== "agent") return null;
  return {
    kind,
    name: text(row, "name"),
    status: agentStatusOf(row),
    launchOrder: int(row, "launch_order"),
    reviveCount: int(row, "revive_count"),
    activity: activityOf(row),
    cost: real(row, "cost"),
    ...common,
  };
}

/** `User` first, then agents by launch order. Main and System are senders only and never listed. */
export function listParticipants(db: SwarmDb, swarmId: number): ParticipantView[] {
  const rows = db.sql
    .prepare(
      `${PARTICIPANT_SELECT} WHERE p.swarm_id = ? AND p.kind IN ('user', 'agent')
       ORDER BY p.kind = 'agent', p.launch_order`,
    )
    .all(swarmId);
  return rows.flatMap((row) => participantOf(row) ?? []);
}

/** Case-insensitive; `null` for unknown names and for Main/System. */
export function getParticipant(db: SwarmDb, swarmId: number, name: string): ParticipantView | null {
  const row = db.sql.prepare(`${PARTICIPANT_SELECT} WHERE p.swarm_id = ? AND p.name = ?`).get(swarmId, name);
  return row === undefined ? null : participantOf(row);
}

export interface ParticipantRef {
  name: string;
  kind: ParticipantKind;
}

/** Any participant including Main and System, case-insensitive, with its canonical name. */
export function findParticipant(db: SwarmDb, swarmId: number, name: string): ParticipantRef | null {
  const row = db.sql.prepare("SELECT name, kind FROM participants WHERE swarm_id = ? AND name = ?").get(swarmId, name);
  return row === undefined ? null : { name: text(row, "name"), kind: kindOf(row) };
}

/** Everyone an agent may message: agents in launch order, then `User`. */
export function listMessageableNames(db: SwarmDb, swarmId: number): string[] {
  return db.sql
    .prepare(
      `SELECT name FROM participants WHERE swarm_id = ? AND kind IN ('agent', 'user')
       ORDER BY kind = 'user', launch_order`,
    )
    .all(swarmId)
    .map((row) => text(row, "name"));
}

/** Absolute session file per agent, in launch order. */
export function listAgentSessions(db: SwarmDb, swarmId: number): { name: string; sessionFile: string }[] {
  return db.sql
    .prepare("SELECT name, session_file FROM participants WHERE swarm_id = ? AND kind = 'agent' ORDER BY launch_order")
    .all(swarmId)
    .map((row) => ({ name: text(row, "name"), sessionFile: path.join(db.dataDir, text(row, "session_file")) }));
}

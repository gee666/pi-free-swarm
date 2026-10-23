// Read side of swarms and participants. Swarm status is resolved on read: a live status with a stale run
// lock is reported as `interrupted` until the next sweep writes it.
import path from "node:path";
import type { ParticipantKind, ParticipantView, SwarmListItem } from "../api-types.js";
import { USER_NAME, WATCHER_NAME } from "../constants.js";
import type { SwarmDb } from "./db.js";
import { getRunConfiguration } from "./run-configuration.js";
import { readBudget } from "./budget.js";
import { isPidAlive, isRunLockFresh, type PidAlive } from "./locks.js";
import {
  activityOf,
  agentStatusOf,
  int,
  intOrNull,
  kindOf,
  real,
  stringList,
  swarmStatusOf,
  text,
  type Row,
} from "./rows.js";

const SWARM_SELECT = `
  SELECT s.*,
    (SELECT a.closed_run = s.run_count FROM acceptance a WHERE a.swarm_id = s.id) AS admission_closed,
    (SELECT COUNT(*) FROM participants p
      WHERE p.swarm_id = s.id AND p.kind = 'agent' AND p.name <> '${WATCHER_NAME}' AND p.retired_at IS NULL AND p.status = 'working') AS agents_working
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
    acceptanceCriteria: stringList(row, "acceptance_criteria"),
    status: wantsLive && !live ? "interrupted" : stored,
    acceptsMessages: live && row.admission_closed !== 1,
    agentAmount: int(row, "agent_amount"),
    agentsWorking: live ? int(row, "agents_working") : 0,
    runCount: int(row, "run_count"),
    runnerPid: live ? runnerPid : null,
    createdAt: int(row, "created_at"),
    startedAt: intOrNull(row, "started_at"),
    finishedAt: intOrNull(row, "finished_at"),
  };
}

function budgetOf(db: SwarmDb, swarmId: number, run: number, now: number) {
  const config = getRunConfiguration(db, swarmId, run);
  if (!config) return null;
  return readBudget(
    db,
    swarmId,
    {
      budgetMoneyUsd: config.effective.budget.moneyUsd ?? undefined,
      budgetTimeSeconds: config.effective.budget.timeSeconds ?? undefined,
      gracefulShutdownOnBudget: config.effective.budget.gracefulShutdown,
    },
    now,
  );
}

/** Newest first. */
export function listSwarms(db: SwarmDb, now: number, alive: PidAlive = isPidAlive): SwarmListItem[] {
  return db.sql
    .prepare(`${SWARM_SELECT} ORDER BY s.id DESC`)
    .all()
    .map((row) => ({
      ...swarmOf(row, now, alive),
      configuration: getRunConfiguration(db, int(row, "id"), int(row, "run_count")),
      budget: budgetOf(db, int(row, "id"), int(row, "run_count"), now),
    }));
}

export function getSwarm(
  db: SwarmDb,
  swarmId: number,
  now: number,
  alive: PidAlive = isPidAlive,
): SwarmListItem | null {
  const row = db.sql.prepare(`${SWARM_SELECT} WHERE s.id = ?`).get(swarmId);
  return row === undefined
    ? null
    : {
        ...swarmOf(row, now, alive),
        configuration: getRunConfiguration(db, swarmId, int(row, "run_count")),
        budget: budgetOf(db, swarmId, int(row, "run_count"), now),
      };
}

const PARTICIPANT_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM message_recipients r
      WHERE r.swarm_id = p.swarm_id AND r.name = p.name AND r.status IN ('pending', 'delivered')) AS unread,
    (SELECT COALESCE(SUM(u.cost), 0) FROM usage u WHERE u.swarm_id = p.swarm_id AND u.agent = p.name) AS cost
  FROM participants p`;

function retiredAssignment(row: Row) {
  if (typeof row.retired_provider !== "string" || typeof row.retired_model_id !== "string") return null;
  return {
    name: text(row, "name"),
    provider: row.retired_provider,
    modelId: row.retired_model_id,
    thinkingLevel: typeof row.retired_thinking_level === "string" ? row.retired_thinking_level : null,
  };
}

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
    retiredAt: intOrNull(row, "retired_at"),
    firstIdleAt: intOrNull(row, "first_idle_at"),
    model: retiredAssignment(row),
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
  const assignments = currentAssignments(db, swarmId);
  return rows.flatMap<ParticipantView>((row) => {
    const participant = participantOf(row);
    if (!participant) return [];
    return participant.kind === "agent"
      ? [
          {
            ...participant,
            model: assignments.find((item) => item.name === participant.name) ?? participant.model ?? null,
          },
        ]
      : [participant];
  });
}

function currentAssignments(db: SwarmDb, swarmId: number) {
  const row = db.sql.prepare("SELECT run_count FROM swarms WHERE id = ?").get(swarmId);
  return row ? (getRunConfiguration(db, swarmId, int(row, "run_count"))?.effective.workers ?? []) : [];
}

/** Case-insensitive; `null` for unknown names and for Main/System. */
export function getParticipant(db: SwarmDb, swarmId: number, name: string): ParticipantView | null {
  const row = db.sql.prepare(`${PARTICIPANT_SELECT} WHERE p.swarm_id = ? AND p.name = ?`).get(swarmId, name);
  if (row === undefined) return null;
  const participant = participantOf(row);
  if (participant?.kind !== "agent") return participant;
  const assignments = currentAssignments(db, swarmId);
  return {
    ...participant,
    model: assignments.find((item) => item.name === participant.name) ?? participant.model ?? null,
  };
}

export interface ParticipantRef {
  name: string;
  kind: ParticipantKind;
  retiredAt?: number;
}

/** Any participant including Main and System, case-insensitive, with its canonical name. */
export function findParticipant(db: SwarmDb, swarmId: number, name: string): ParticipantRef | null {
  const row = db.sql
    .prepare("SELECT name, kind, retired_at FROM participants WHERE swarm_id = ? AND name = ?")
    .get(swarmId, name);
  if (!row) return null;
  const retiredAt = intOrNull(row, "retired_at");
  return { name: text(row, "name"), kind: kindOf(row), ...(retiredAt === null ? {} : { retiredAt }) };
}

/** Everyone an agent may message: agents in launch order, then `User`. */
export function listMessageableNames(db: SwarmDb, swarmId: number): string[] {
  return db.sql
    .prepare(
      `SELECT name FROM participants WHERE swarm_id = ? AND kind IN ('agent', 'user') AND retired_at IS NULL
       ORDER BY kind = 'user', launch_order`,
    )
    .all(swarmId)
    .map((row) => text(row, "name"));
}

/** Absolute session file per agent, in launch order. */
export function listAgentSessions(
  db: SwarmDb,
  swarmId: number,
  options: { activeOnly?: boolean } = {},
): { name: string; sessionFile: string }[] {
  return db.sql
    .prepare(
      `SELECT name, session_file FROM participants WHERE swarm_id = ? AND kind = 'agent' ${options.activeOnly ? "AND retired_at IS NULL" : ""} ORDER BY launch_order`,
    )
    .all(swarmId)
    .map((row) => ({ name: text(row, "name"), sessionFile: path.join(db.dataDir, text(row, "session_file")) }));
}

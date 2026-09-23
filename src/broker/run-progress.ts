// The live snapshot the swarm tools stream into the terminal tool box about once a second (plan §9).
import type { ParticipantStatus, SwarmStatus } from "../api-types.js";
import { USER_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { unreadCounts } from "../store/message-queries.js";
import { getStats } from "../store/stats-queries.js";
import { getSwarm, listParticipants } from "../store/swarm-queries.js";

export interface RunProgress {
  swarmId: number;
  swarmName: string;
  run: number;
  status: SwarmStatus;
  agents: Record<ParticipantStatus, number>;
  posts: number;
  messages: number;
  unreadForUser: number;
  /** Of the current run. */
  elapsedMs: number;
  /** Cost and tokens (cache included) of all runs. */
  cost: number;
  tokens: number;
  boardUrl: string | null;
}

export function readRunProgress(db: SwarmDb, swarmId: number, now: number, boardUrl: string | null): RunProgress {
  const swarm = getSwarm(db, swarmId, now);
  const stats = getStats(db, swarmId, now);
  if (swarm === null || stats === null) throw new Error(`Swarm #${swarmId} not found.`);
  const agents: Record<ParticipantStatus, number> = {
    pending: 0,
    starting: 0,
    working: 0,
    idle: 0,
    crashed: 0,
    stopped: 0,
  };
  for (const participant of listParticipants(db, swarmId)) {
    if (participant.kind === "agent") agents[participant.status]++;
  }
  const { totals } = stats;
  const startedAt = swarm.startedAt ?? now;
  return {
    swarmId,
    swarmName: swarm.name,
    run: swarm.runCount,
    status: swarm.status,
    agents,
    posts: totals.posts,
    messages: totals.messages,
    unreadForUser: unreadCounts(db, swarmId, [USER_NAME])[USER_NAME] ?? 0,
    elapsedMs: Math.max(0, (swarm.finishedAt ?? now) - startedAt),
    cost: totals.cost,
    tokens: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    boardUrl,
  };
}

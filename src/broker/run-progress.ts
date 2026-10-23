// The live snapshot the swarm tools stream into the terminal tool box about once a second (plan §9).
import type { ParticipantStatus, SwarmStatus } from "../api-types.js";
import type { SwarmDb } from "../store/db.js";
import { getProgressSnapshot } from "../store/progress-queries.js";

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
  const swarm = getProgressSnapshot(db, swarmId, now);
  if (swarm === null) throw new Error(`Swarm #${swarmId} not found.`);
  const startedAt = swarm.startedAt ?? now;
  return {
    swarmId,
    swarmName: swarm.name,
    run: swarm.run,
    status: swarm.status,
    agents: swarm.agents,
    posts: swarm.posts,
    messages: swarm.messages,
    unreadForUser: swarm.unreadForUser,
    elapsedMs: Math.max(0, (swarm.finishedAt ?? now) - startedAt),
    cost: swarm.cost,
    tokens: swarm.tokens,
    boardUrl,
  };
}

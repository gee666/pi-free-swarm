// The only place that turns an AgentSupervisor's callbacks into DB writes (agents/* stays DB-free).
import type { AgentCrash, SupervisorHooks } from "../agents/supervisor.js";
import type { Clock } from "../clock.js";
import type { SwarmDb } from "../store/db.js";
import { recordUsage, setAgentActivity, setAgentStatus } from "./agent-state.js";
import { markRead } from "./delivery-state.js";
import { guardRunAction } from "./run-failure.js";

export interface AgentHooksContext {
  db: SwarmDb;
  swarmId: number;
  name: string;
  clock: Clock;
  /** True once the run is ending: endRun writes the final statuses, so stop() transitions are dropped. */
  isEnding(): boolean;
  onCrash(crash: AgentCrash): void;
  onError?(error: unknown): void;
}

export function createAgentHooks(ctx: AgentHooksContext): SupervisorHooks {
  const { db, swarmId, name, clock } = ctx;
  const write = (action: () => void) => {
    if (ctx.isEnding()) return;
    if (ctx.onError) guardRunAction(action, ctx.onError);
    else action();
  };
  return {
    onStatus: (status) => write(() => setAgentStatus(db, swarmId, name, status, clock.now())),
    onActivity: (activity) => write(() => setAgentActivity(db, swarmId, name, activity, clock.now())),
    onMessagesRead: (ids) =>
      write(() => {
        markRead(db, swarmId, name, ids, clock.now());
      }),
    onUsage: (sample) => write(() => recordUsage(db, swarmId, name, sample, clock.now())),
    onCrash: (crash) => write(() => ctx.onCrash(crash)),
  };
}

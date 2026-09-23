// The only place that turns an AgentSupervisor's callbacks into DB writes (agents/* stays DB-free).
import type { AgentCrash, SupervisorHooks } from "../agents/supervisor.js";
import type { Clock } from "../clock.js";
import type { SwarmDb } from "../store/db.js";
import { recordUsage, setAgentActivity, setAgentStatus } from "./agent-state.js";
import { markRead } from "./delivery-state.js";

export interface AgentHooksContext {
  db: SwarmDb;
  swarmId: number;
  name: string;
  clock: Clock;
  /** True once the run is ending: endRun writes the final statuses, so stop() transitions are dropped. */
  isEnding(): boolean;
  onCrash(crash: AgentCrash): void;
}

export function createAgentHooks(ctx: AgentHooksContext): SupervisorHooks {
  const { db, swarmId, name, clock } = ctx;
  return {
    onStatus(status) {
      if (!ctx.isEnding()) setAgentStatus(db, swarmId, name, status, clock.now());
    },
    onActivity(activity) {
      if (!ctx.isEnding()) setAgentActivity(db, swarmId, name, activity, clock.now());
    },
    // Reads and usage stay recorded while ending: status guards keep reads monotonic, and spent tokens are real.
    onMessagesRead(messageIds) {
      markRead(db, swarmId, name, messageIds, clock.now());
    },
    onUsage(sample) {
      recordUsage(db, swarmId, name, sample, clock.now());
    },
    onCrash(crash) {
      if (!ctx.isEnding()) ctx.onCrash(crash);
    },
  };
}

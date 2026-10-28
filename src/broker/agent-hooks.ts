// The only place that turns an AgentSupervisor's callbacks into DB writes (agents/* stays DB-free).
import type { AgentCrash, SupervisorHooks } from "../agents/supervisor.js";
import type { Clock } from "../clock.js";
import type { SwarmDb } from "../store/db.js";
import { setAgentActivity, setAgentStatus } from "./agent-state.js";
import { markRead } from "./delivery-state.js";
import { guardRunAction } from "./run-failure.js";
import { readRunOwnership } from "./run-ownership.js";
import { recordAgentUsage } from "./usage-recording.js";

export interface AgentHooksContext {
  db: SwarmDb;
  swarmId: number;
  run?: number;
  runnerPid?: number;
  /** Captured for this process's actual model, never inferred later from changed catalog prices. */
  modelPricingKnown?: boolean;
  name: string;
  clock: Clock;
  /** True once the run is ending: endRun writes the final statuses, so stop() transitions are dropped. */
  isEnding(): boolean;
  onCrash(crash: AgentCrash): void;
  onError?(error: unknown): void;
}

export function createAgentHooks(ctx: AgentHooksContext): SupervisorHooks {
  const { db, swarmId, name, clock } = ctx;
  const write = (action: () => void, allowWhileEnding = false) => {
    const apply = () => {
      if (allowWhileEnding) return action();
      if (ctx.isEnding()) return;
      db.write(() => {
        if (ctx.isEnding()) return;
        if (ctx.run !== undefined && readRunOwnership(db, swarmId, ctx.run, ctx.runnerPid) !== "owned") return;
        action();
      });
    };
    if (ctx.onError) guardRunAction(apply, ctx.onError);
    else apply();
  };
  return {
    onStatus: (status) => write(() => setAgentStatus(db, swarmId, name, status, clock.now())),
    onActivity: (activity) => write(() => setAgentActivity(db, swarmId, name, activity, clock.now())),
    onMessagesRead: (ids) =>
      write(() => {
        db.write(() => {
          markRead(db, swarmId, name, ids, clock.now());
        });
      }),
    onUsage: (sample) =>
      // Closing children can still report attributable usage; other callbacks remain fenced.
      write(() => {
        recordAgentUsage(db, swarmId, name, sample, clock.now(), ctx.run, ctx.modelPricingKnown);
      }, true),
    onCrash: (crash) => write(() => ctx.onCrash(crash)),
  };
}

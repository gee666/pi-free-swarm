// Agent mode (PI_SWARM_ROLE=agent): a child spawned by a swarm runner. It gets only the swarm_* tools and
// the parent watch; never swarm/resume_swarm (no recursion) and never the board host.
import type { TimerHandle } from "./clock.js";
import type { SwarmExtensionApi } from "./extension-api.js";
import { AGENT_NAME_ENV, DB_ENV, RUNNER_PID_ENV, RUN_ENV, SWARM_ID_ENV, WATCHER_NAME } from "./constants.js";
import { startParentWatch } from "./agents/parent-watch.js";
import { openSwarmDb, type SwarmDb } from "./store/db.js";
import { registerWatcherTools } from "./tools/watcher-tools.js";
import { IDLE_ONLY_TOOLS, registerAgentTools } from "./tools/agent-tools.js";
import { workerHasIdled } from "./broker/worker-eligibility.js";

export interface AgentEnv {
  dbPath: string;
  swarmId: number;
  run: number;
  agentName: string;
  runnerPid: number;
}

function positiveInteger(raw: string | undefined): number | null {
  const value = Number(raw);
  return raw !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The error names what is missing, so a broken spawn is visible instead of a silently tool-less agent. */
export function readAgentEnv(env: NodeJS.ProcessEnv): { ok: true; value: AgentEnv } | { ok: false; error: string } {
  const dbPath = env[DB_ENV] ?? "";
  const agentName = env[AGENT_NAME_ENV] ?? "";
  const swarmId = positiveInteger(env[SWARM_ID_ENV]);
  const runnerPid = positiveInteger(env[RUNNER_PID_ENV]);
  const run = positiveInteger(env[RUN_ENV]);
  if (dbPath !== "" && agentName !== "" && swarmId !== null && runnerPid !== null && run !== null) {
    return { ok: true, value: { dbPath, swarmId, run, agentName, runnerPid } };
  }
  const missing = [
    dbPath === "" ? DB_ENV : null,
    swarmId === null ? SWARM_ID_ENV : null,
    agentName === "" ? AGENT_NAME_ENV : null,
    runnerPid === null ? RUNNER_PID_ENV : null,
    run === null ? RUN_ENV : null,
  ].filter((name) => name !== null);
  return {
    ok: false,
    error: `pi-free-swarm agent mode: missing or invalid ${missing.join(", ")}; swarm tools disabled.`,
  };
}

export function registerAgentMode(pi: SwarmExtensionApi, env: NodeJS.ProcessEnv): void {
  const parsed = readAgentEnv(env);
  if (!parsed.ok) {
    // stderr, not ctx.ui: the runner ignores a child's notify records but keeps its stderr for crash reports.
    pi.on("session_start", () => console.error(parsed.error));
    return;
  }
  const identity = parsed.value;
  // Opened for persisted tool eligibility or the first tool call; the runner creates the DB.
  let db: SwarmDb | null = null;
  let watch: TimerHandle | null = null;
  registerAgentTools(pi, {
    getDb: () => (db ??= openSwarmDb(identity.dbPath, { create: false })),
    swarmId: identity.swarmId,
    run: identity.run,
    agentName: identity.agentName,
  });
  if (identity.agentName === WATCHER_NAME)
    registerWatcherTools(pi, {
      getDb: () => (db ??= openSwarmDb(identity.dbPath, { create: false })),
      swarmId: identity.swarmId,
      run: identity.run,
      agentName: identity.agentName,
    });
  let idleToolsAvailable: boolean | undefined;
  const setIdleTools = (available: boolean) => {
    if (idleToolsAvailable === available) return;
    const active = pi.getActiveTools().filter((name) => !IDLE_ONLY_TOOLS.includes(name));
    pi.setActiveTools(available ? [...active, ...IDLE_ONLY_TOOLS] : active);
    idleToolsAvailable = available;
  };
  pi.on("agent_settled", () => {
    if (identity.agentName !== WATCHER_NAME) setIdleTools(true);
  });
  pi.on("session_start", (_event, ctx) => {
    watch?.cancel();
    watch = startParentWatch({
      runnerPid: identity.runnerPid,
      abort: () => ctx.abort(),
      shutdown: () => ctx.shutdown(),
    });
    let available = false;
    try {
      if (identity.agentName !== WATCHER_NAME) {
        db ??= openSwarmDb(identity.dbPath, { create: false });
        available = workerHasIdled(db, identity.swarmId, identity.agentName);
      }
    } finally {
      setIdleTools(available);
    }
  });
  pi.on("session_shutdown", () => {
    watch?.cancel();
    watch = null;
    db?.close();
    db = null;
  });
}

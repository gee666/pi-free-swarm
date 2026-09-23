// Agent mode (PI_SWARM_ROLE=agent): a child spawned by a swarm runner. It gets only the swarm_* tools and
// the parent watch; never swarm/resume_swarm (no recursion) and never the board host.
import type { TimerHandle } from "./clock.js";
import type { SwarmExtensionApi } from "./extension-api.js";
import { AGENT_NAME_ENV, DB_ENV, RUNNER_PID_ENV, SWARM_ID_ENV } from "./constants.js";
import { startParentWatch } from "./agents/parent-watch.js";
import { openSwarmDb, type SwarmDb } from "./store/db.js";
import { registerAgentTools } from "./tools/agent-tools.js";

export interface AgentEnv {
  dbPath: string;
  swarmId: number;
  agentName: string;
  runnerPid: number;
}

function positiveInteger(raw: string | undefined): number | null {
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value > 0 ? value : null;
}

/** The error names what is missing, so a broken spawn is visible instead of a silently tool-less agent. */
export function readAgentEnv(env: NodeJS.ProcessEnv): { ok: true; value: AgentEnv } | { ok: false; error: string } {
  const dbPath = env[DB_ENV] ?? "";
  const agentName = env[AGENT_NAME_ENV] ?? "";
  const swarmId = positiveInteger(env[SWARM_ID_ENV]);
  const runnerPid = positiveInteger(env[RUNNER_PID_ENV]);
  if (dbPath !== "" && agentName !== "" && swarmId !== null && runnerPid !== null) {
    return { ok: true, value: { dbPath, swarmId, agentName, runnerPid } };
  }
  const missing = [
    dbPath === "" ? DB_ENV : null,
    swarmId === null ? SWARM_ID_ENV : null,
    agentName === "" ? AGENT_NAME_ENV : null,
    runnerPid === null ? RUNNER_PID_ENV : null,
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
  // Opened on the first tool call; the runner created the DB before spawning us.
  let db: SwarmDb | null = null;
  let watch: TimerHandle | null = null;
  registerAgentTools(pi, {
    getDb: () => (db ??= openSwarmDb(identity.dbPath, { create: false })),
    swarmId: identity.swarmId,
    agentName: identity.agentName,
  });
  pi.on("session_start", (_event, ctx) => {
    watch?.cancel();
    watch = startParentWatch({
      runnerPid: identity.runnerPid,
      abort: () => ctx.abort(),
      shutdown: () => ctx.shutdown(),
    });
  });
  pi.on("session_shutdown", () => {
    watch?.cancel();
    watch = null;
    db?.close();
    db = null;
  });
}

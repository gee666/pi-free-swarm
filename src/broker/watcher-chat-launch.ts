import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AgentLaunchSpec } from "../agents/launch.js";
import { readSessionModel } from "../agents/session-model.js";
import { watchdogConfigFromEnv, type WatchdogConfig } from "../agents/watchdog.js";
import { SYSTEM_PROMPT_FILE, WATCHER_CHAT_ENV, WATCHER_NAME } from "../constants.js";
import { buildAgentEnv, loadSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import { readBudget } from "../store/budget.js";
import { getRunConfiguration } from "../store/run-configuration.js";
import { getSwarm, listAgentSessions } from "../store/swarm-queries.js";
import { hasUnverifiedUsageCost } from "../store/usage-provenance.js";

export function checkWatcherChatBudget(db: SwarmDb, swarmId: number, now: number): void {
  const cwd = path.resolve(db.dataDir, "../..");
  const budget = readBudget(db, swarmId, loadSettings(cwd).settings, now);
  if (budget.moneyUsd !== null && (budget.hasAccountingGaps || hasUnverifiedUsageCost(db, swarmId))) {
    throw new Error("Watcher chat cannot spend against a money budget with incomplete usage accounting.");
  }
  if (budget.exhausted === "money") throw new Error("Watcher chat money budget is exhausted.");
}

export async function watcherChatLaunch(
  db: SwarmDb,
  swarmId: number,
  sessionFile: string,
  now: number,
): Promise<{
  spec: AgentLaunchSpec;
  run: number;
  watchdog: WatchdogConfig;
}> {
  const cwd = path.resolve(db.dataDir, "../..");
  const settings = loadSettings(cwd).settings;
  const { swarm, saved, recordedSession } = db.read(() => ({
    swarm: getSwarm(db, swarmId, now),
    saved: getRunConfiguration(db, swarmId),
    recordedSession: listAgentSessions(db, swarmId).find((agent) => agent.name === WATCHER_NAME),
  }));
  if (!swarm) throw new Error("Swarm no longer exists.");
  const config = saved?.effective;
  const model = config?.watcher ?? (recordedSession ? await readSessionModel(recordedSession.sessionFile) : null);
  if (!model)
    throw new Error("No recorded Watcher model is available in the saved run configuration or Watcher session.");
  const run = saved?.run ?? swarm.runCount;
  if (run < 1) throw new Error("Watcher chat requires an originating swarm run for usage accounting.");
  checkWatcherChatBudget(db, swarmId, now);
  const defaults = watchdogConfigFromEnv();
  return {
    run,
    watchdog: {
      startupTimeoutMs: config?.timing.startupTimeoutMs ?? defaults.startupTimeoutMs,
      idleTimeoutMs: config?.timing.idleTimeoutMs ?? defaults.idleTimeoutMs,
      startupRetries: config?.timing.startupRetries ?? defaults.startupRetries,
    },
    spec: {
      name: WATCHER_NAME,
      cwd,
      sessionFile,
      systemPromptFile: path.join(path.dirname(sessionFile), SYSTEM_PROMPT_FILE),
      context: {
        extensionArgs: config?.launch.extensionArgs ?? [fileURLToPath(new URL("../../index.ts", import.meta.url))],
        noExtensions: config?.launch.noExtensions ?? true,
        projectTrusted: config?.launch.projectTrusted ?? false,
        model,
      },
      maxRpcFrameBytes: config?.limits.maxRpcFrameBytes ?? settings.maxRpcFrameBytes,
      env: {
        ...buildAgentEnv(settings, { dbPath: db.path, swarmId, run, agentName: WATCHER_NAME, runnerPid: process.pid }),
        [WATCHER_CHAT_ENV]: "1",
      },
    },
  };
}

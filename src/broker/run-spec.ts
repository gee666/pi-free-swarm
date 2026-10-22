import path from "node:path";
import type { AgentLaunchSpec } from "../agents/launch.js";
import { SYSTEM_PROMPT_FILE } from "../constants.js";
import { buildAgentEnv } from "../settings.js";
import type { RunEnvironment } from "./run-types.js";

export function buildRunSpec(
  env: RunEnvironment,
  swarmId: number,
  name: string,
  sessionFile: string,
  run: number,
): AgentLaunchSpec {
  return {
    name,
    cwd: env.cwd,
    sessionFile,
    systemPromptFile: path.join(path.dirname(sessionFile), SYSTEM_PROMPT_FILE),
    context: env.launch,
    env: buildAgentEnv(env.settings, { dbPath: env.db.path, swarmId, run, agentName: name, runnerPid: env.runnerPid }),
  };
}

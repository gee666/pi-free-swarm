import path from "node:path";
import type { AgentLaunchSpec } from "../agents/launch.js";
import { SYSTEM_PROMPT_FILE } from "../constants.js";
import { buildAgentEnv } from "../settings.js";
import type { RunEnvironment } from "./run-types.js";
import type { ModelSelection } from "../runtime-types.js";

export function buildRunSpec(
  env: RunEnvironment,
  swarmId: number,
  name: string,
  sessionFile: string,
  run: number,
  model?: ModelSelection,
): AgentLaunchSpec {
  return {
    name,
    cwd: env.cwd,
    sessionFile,
    systemPromptFile: path.join(path.dirname(sessionFile), SYSTEM_PROMPT_FILE),
    context: model
      ? {
          ...env.launch,
          model: { provider: model.provider, modelId: model.modelId, thinkingLevel: model.thinkingLevel },
        }
      : env.launch,
    maxRpcFrameBytes: env.settings.maxRpcFrameBytes,
    env: buildAgentEnv(env.settings, { dbPath: env.db.path, swarmId, run, agentName: name, runnerPid: env.runnerPid }),
  };
}

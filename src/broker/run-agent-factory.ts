import type { SwarmListItem } from "../api-types.js";
import type { ModelSelection } from "../runtime-types.js";
import { RunAgent, type ReplacementHandoff, type RunAgentContext } from "./run-agent.js";
import { buildRunSpec } from "./run-spec.js";
import type { RunEnvironment, RunTimings } from "./run-types.js";

export type RunAgentServices = Pick<
  RunAgentContext,
  "collect" | "isEnding" | "canContinue" | "onStatus" | "onReady" | "onRealMessage" | "onError" | "onCrash"
>;

/** Initial and live workers share exactly the same launch and observation boundary. */
export function runAgentFactory(
  env: RunEnvironment,
  swarm: SwarmListItem,
  run: number,
  timings: RunTimings,
  services: RunAgentServices,
): (
  session: { name: string; sessionFile: string },
  assignment?: ModelSelection,
  handoff?: ReplacementHandoff,
) => RunAgent {
  const context: RunAgentContext = {
    db: env.db,
    swarmId: swarm.id,
    run,
    runnerPid: env.runnerPid,
    swarmName: swarm.name,
    taskPrompt: swarm.taskPrompt,
    acceptanceCriteria: swarm.acceptanceCriteria,
    clock: env.clock,
    watchdog: timings.watchdog,
    ...services,
  };
  return (session, assignment, handoff) =>
    new RunAgent(buildRunSpec(env, swarm.id, session.name, session.sessionFile, run, assignment), context, handoff);
}

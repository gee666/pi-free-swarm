import { recordResumeFeedback } from "./project.js";
import { findActiveRun } from "./run-registry.js";
import { RESUME_STAGGER_MS } from "../constants.js";
import { pickAgentNames } from "../names.js";
import { sendMainFeedback } from "./messages.js";
import { SwarmRun } from "./swarm-run.js";
import { bestEffortEnd, reportRunFailure } from "./run-failure.js";
import type { SwarmListItem } from "../api-types.js";
import { beginResume, createSwarm } from "./swarms.js";
import type { RunEnvironment, RunOptions, RunOutcome } from "./run-types.js";

/** Claims the run lock atomically with the new swarm. */
function executeRun(
  env: RunEnvironment,
  swarm: SwarmListItem,
  run: number,
  options: RunOptions,
  stagger: number,
): Promise<RunOutcome> {
  try {
    return new SwarmRun(env, swarm, run, options).execute(stagger);
  } catch (error) {
    bestEffortEnd(env, swarm.id, run);
    reportRunFailure(env, swarm.id);
    return Promise.reject(error);
  }
}

export async function startSwarm(
  env: RunEnvironment,
  input: { name: string; taskPrompt: string; acceptanceCriteria: readonly string[]; agentAmount: number },
  options: RunOptions,
): Promise<RunOutcome> {
  const agentNames = pickAgentNames(input.agentAmount);
  const { db, runnerPid, clock } = env;
  const swarm = createSwarm(db, {
    name: input.name,
    taskPrompt: input.taskPrompt,
    acceptanceCriteria: input.acceptanceCriteria,
    agentNames,
    runnerPid,
    now: clock.now(),
  });
  return executeRun(env, swarm, 1, options, env.settings.staggerSeconds * 1000);
}

/** Feedback and lock acquisition join the same synchronous transaction. */
export async function resumeSwarm(
  env: RunEnvironment,
  input: { swarmId: number; message: string },
  options: RunOptions,
): Promise<RunOutcome> {
  const { db, runnerPid, clock } = env;
  const active = findActiveRun(db.path, input.swarmId);
  if (active) {
    db.write(() => {
      recordResumeFeedback(db, input.swarmId, input.message, clock.now());
      sendMainFeedback(db, input.swarmId, input.message, clock.now());
    });
    return active.wait(options);
  }
  const { swarm, run } = db.write(() => {
    const resumed = beginResume(db, input.swarmId, runnerPid, clock.now());
    recordResumeFeedback(db, input.swarmId, input.message, clock.now());
    sendMainFeedback(db, input.swarmId, input.message, clock.now());
    return resumed;
  });
  return executeRun(env, swarm, run, options, env.timings?.resumeStaggerMs ?? RESUME_STAGGER_MS);
}

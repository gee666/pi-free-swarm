import { recordResumeUpdate } from "./project.js";
import { findActiveRun } from "./run-registry.js";
import { RESUME_STAGGER_MS } from "../constants.js";
import { pickAgentNames } from "../names.js";
import { sendMainFeedback } from "./main-feedback.js";
import { SwarmRun } from "./swarm-run.js";
import { bestEffortEnd, reportRunFailure } from "./run-failure.js";
import type { SwarmDb } from "../store/db.js";
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

function recordUpdate(db: SwarmDb, swarmId: number, message: string, now: number): void {
  const update = recordResumeUpdate(db, swarmId, message, now);
  sendMainFeedback(
    db,
    swarmId,
    message,
    now,
    `The brief file ${update.briefPath} has a new section "Update for run ${update.run}". Read it and derive criteria and tasks from it.`,
  );
}

/** Brief updates and lock acquisition join the same synchronous transaction. */
async function continueSwarm(
  env: RunEnvironment,
  swarmId: number,
  options: RunOptions,
  message?: string,
): Promise<RunOutcome> {
  const { db, runnerPid, clock } = env;
  const active = findActiveRun(db.path, swarmId);
  if (active) {
    if (message !== undefined) db.write(() => recordUpdate(db, swarmId, message, clock.now()));
    return active.wait(options);
  }
  const { swarm, run } = db.write(() => {
    const resumed = beginResume(db, swarmId, runnerPid, clock.now(), message === undefined);
    if (message !== undefined) recordUpdate(db, swarmId, message, clock.now());
    return resumed;
  });
  return executeRun(
    env,
    swarm,
    run,
    { ...options, restart: message === undefined },
    env.timings?.resumeStaggerMs ?? RESUME_STAGGER_MS,
  );
}

export function resumeSwarm(
  env: RunEnvironment,
  input: { swarmId: number; message: string },
  options: RunOptions,
): Promise<RunOutcome> {
  return continueSwarm(env, input.swarmId, options, input.message);
}

export function restartSwarm(
  env: RunEnvironment,
  input: { swarmId: number },
  options: RunOptions,
): Promise<RunOutcome> {
  return continueSwarm(env, input.swarmId, options);
}

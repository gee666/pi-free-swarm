import { DEFAULT_MAX_RPC_FRAME_BYTES } from "../agents/jsonl.js";
import { watchdogConfigFromEnv } from "../agents/watchdog.js";
import { WATCHER_NAME } from "../constants.js";
import { resolveModelAssignments } from "../model-allocation.js";
import type { RunConfiguration, WorkerAssignment } from "../run-configuration.js";
import type { ModelSelection } from "../runtime-types.js";
import { getRunConfiguration, saveRunConfiguration } from "../store/run-configuration.js";
import type { RunEnvironment, RunTimings } from "./run-types.js";

/** Named assignments outlive process instances. A resume never silently reassigns a worker. */
export function configureRun(
  env: RunEnvironment,
  swarmId: number,
  run: number,
  names: readonly string[],
  timing: RunTimings,
): ReadonlyMap<string, ModelSelection> {
  const workers = names.filter((name) => name !== WATCHER_NAME);
  const requested = resolveModelAssignments(
    workers.length,
    env.settings.models,
    env.launch.model,
    env.availableModels ?? [],
  );
  const proposed = workers.map((name, index) => {
    const model = requested[index];
    if (!model) throw new Error(`Missing model assignment for ${name}`);
    return { name, ...model };
  });
  const previous = getRunConfiguration(env.db, swarmId);
  const assignments = previous ? retainAssignments(previous.effective.workers, workers) : proposed;
  if (previous && JSON.stringify(assignments) !== JSON.stringify(proposed)) {
    env.notifyUser(
      "Requested worker model settings differ from the saved run. Keeping each worker's recorded model/thinking assignment on resume.",
    );
  }
  validateRetainedModels(assignments, env);
  const watchdog = timing.watchdog ?? watchdogConfigFromEnv();
  const configuration: RunConfiguration = {
    version: 1,
    workers: assignments,
    launch: {
      projectTrusted: env.launch.projectTrusted,
      noExtensions: env.launch.noExtensions ?? false,
      extensionArgs: [...env.launch.extensionArgs],
    },
    timing: {
      staggerSeconds: env.settings.staggerSeconds,
      idleReminderDelay: env.settings.idleReminderDelay,
      idleReminderDigestSize: env.settings.idleReminderDigestSize,
      heartbeatMs: timing.heartbeatMs,
      deliveryPollMs: timing.deliveryPollMs,
      completionCheckMs: timing.completionCheckMs,
      progressMs: timing.progressMs,
      resumeStaggerMs: timing.resumeStaggerMs,
      reviveBackoffMs: [...timing.reviveBackoffMs],
      startupTimeoutMs: watchdog.startupTimeoutMs,
      idleTimeoutMs: watchdog.idleTimeoutMs,
      startupRetries: watchdog.startupRetries,
    },
    limits: {
      bodyMaxChars: env.settings.bodyMaxChars,
      maxRpcFrameBytes: env.settings.maxRpcFrameBytes ?? DEFAULT_MAX_RPC_FRAME_BYTES,
    },
    budget: {
      moneyUsd: null,
      timeSeconds: null,
      gracefulShutdown: false,
    },
  };
  const saved = saveRunConfiguration(env.db, swarmId, run, configuration, env.clock.now());
  if (saved.changes.length) env.notifyUser(`Effective run configuration changed: ${saved.changes.join(", ")}.`);
  return new Map(assignments.map(({ name, ...model }) => [name, model]));
}

function retainAssignments(saved: readonly WorkerAssignment[], names: readonly string[]): WorkerAssignment[] {
  if (saved.length !== names.length) throw new Error("Saved worker assignments do not match the resumed team size");
  return names.map((name) => {
    const assignment = saved.find((worker) => worker.name === name);
    if (!assignment) throw new Error(`No saved model assignment for resumed worker ${name}`);
    return { ...assignment };
  });
}

function validateRetainedModels(assignments: readonly WorkerAssignment[], env: RunEnvironment): void {
  if (!env.availableModels) return;
  for (const assignment of assignments) {
    const model = env.availableModels.find(
      (entry) => entry.provider === assignment.provider && entry.id === assignment.modelId,
    );
    if (!model)
      throw new Error(
        `Saved worker model ${assignment.provider}/${assignment.modelId} is unavailable; restore catalog access before resuming`,
      );
    if (assignment.thinkingLevel !== null && !model.thinkingLevels.includes(assignment.thinkingLevel)) {
      throw new Error(
        `Saved worker thinking level ${assignment.thinkingLevel} is unsupported by ${assignment.provider}/${assignment.modelId}`,
      );
    }
  }
}

import type { RunEnvironment } from "./swarm-run.js";
import { endRun } from "./swarms.js";

/** Boundary for callbacks invoked by timers and child stdout, outside the tool's promise chain. */
export function guardRunAction(action: () => void | Promise<void>, fail: (error: unknown) => void): void {
  try {
    const pending = action();
    if (pending) void pending.catch(fail);
  } catch (error) {
    fail(error);
  }
}

export function reportRunFailure(env: RunEnvironment, swarmId: number): void {
  try {
    // Errors from dependencies may contain credentials or SQL values; the rejected tool retains the cause.
    env.notifyUser(`Swarm #${swarmId} stopped because the runtime could not persist its state.`);
  } catch {
    // A failed UI notification must not prevent process cleanup.
  }
}

export function bestEffortEnd(env: RunEnvironment, swarmId: number): void {
  try {
    endRun(env.db, swarmId, env.runnerPid, "stopped", env.clock.now());
  } catch {
    // A closed or unwritable DB cannot be repaired here. A later stale sweep owns recovery.
  }
}

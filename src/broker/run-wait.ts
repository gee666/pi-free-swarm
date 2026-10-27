import type { RunEnvironment, RunOptions, RunOutcome } from "./run-types.js";
import { readRunProgress } from "./run-progress.js";

export async function waitForActiveRun(
  env: RunEnvironment,
  swarmId: number,
  progressMs: number,
  done: Promise<RunOutcome>,
  options: RunOptions,
  stop: () => Promise<void>,
): Promise<RunOutcome> {
  const abort = () => void stop();
  options.signal?.addEventListener("abort", abort, { once: true });
  const report = () => options.onProgress?.(readRunProgress(env.db, swarmId, env.clock.now(), env.boardUrl()));
  const timer = env.clock.every(progressMs, report);
  try {
    report();
    if (options.signal?.aborted) abort();
    return await done;
  } finally {
    timer.cancel();
    options.signal?.removeEventListener("abort", abort);
  }
}

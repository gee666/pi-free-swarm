// Runs inside agent processes. Nothing runs in the runner on SIGKILL or OOM, so each agent checks
// that its runner is alive and exits on its own; no orphan keeps editing files.
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { PARENT_WATCH_INTERVAL_MS, SIGKILL_TIMEOUT_MS } from "../constants.js";

// Same check as store/locks.ts isPidAlive; agents/* may not import store/*.
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** The agent was spawned detached, so its pid is its process group: this takes its tools down too. */
function killOwnProcessGroup(): void {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    process.kill(process.pid, "SIGKILL");
  }
}

export function startParentWatch(options: {
  runnerPid: number;
  abort(): void;
  shutdown(): void;
  clock?: Clock;
  alive?: (pid: number) => boolean;
}): TimerHandle {
  const clock = options.clock ?? systemClock;
  const alive = options.alive ?? isPidAlive;
  const handle = clock.every(PARENT_WATCH_INTERVAL_MS, () => {
    if (alive(options.runnerPid)) return;
    handle.cancel();
    options.abort();
    options.shutdown();
    // Backstop for a shutdown that hangs (e.g. a tool ignoring the abort).
    clock.after(SIGKILL_TIMEOUT_MS, killOwnProcessGroup);
  });
  return handle;
}

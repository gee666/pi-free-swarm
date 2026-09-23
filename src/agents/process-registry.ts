// Exit handlers cannot wait: TERM lets pi clean up its separately detached bash processes.
import type { ChildProcess } from "node:child_process";

const live = new Set<ChildProcess>();

export function registerAgentProcess(proc: ChildProcess): void {
  live.add(proc);
  proc.once("close", () => {
    if (!isAgentGroupAlive(proc)) unregisterAgentProcess(proc);
  });
}

export function isAgentGroupAlive(proc: ChildProcess): boolean {
  if (proc.pid === undefined) return false;
  try {
    process.kill(-proc.pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function unregisterAgentProcess(proc: ChildProcess): void {
  live.delete(proc);
}

/** Requests shutdown of every registered agent; asynchronous stop() owns KILL escalation. */
export function killAllAgentsSync(): void {
  for (const proc of live) {
    if (proc.pid === undefined) continue;
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // The group is already gone.
    }
  }
  live.clear();
}

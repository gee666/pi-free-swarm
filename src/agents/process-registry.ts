// Last-resort cleanup: process "exit" handlers must be synchronous, so they can only SIGKILL.
import type { ChildProcess } from "node:child_process";

const live = new Set<ChildProcess>();

export function registerAgentProcess(proc: ChildProcess): void {
  live.add(proc);
  proc.once("exit", () => live.delete(proc));
}

/** Kills every registered agent's whole process group (its tools included). */
export function killAllAgentsSync(): void {
  for (const proc of live) {
    if (proc.pid === undefined) continue;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // The group is already gone.
    }
  }
  live.clear();
}

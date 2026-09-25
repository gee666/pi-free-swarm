// Late peers: the last agents of a fresh run are held back until the others first go quiet, then join
// with the same prompts and a fresh context. An independent late look catches shared blind spots.
import type { RunAgent } from "./run-agent.js";

/** At least one agent always launches first; resumed runs have no reserve. */
export function reserveCount(agentCount: number, latePeers: number, run: number): number {
  return run === 1 ? Math.max(0, Math.min(latePeers, agentCount - 1)) : 0;
}

export class LateReserve {
  #held: readonly RunAgent[];

  /** `agents` in launch order; the last ones are held. */
  constructor(agents: readonly RunAgent[], latePeers: number, run: number) {
    this.#held = agents.slice(agents.length - reserveCount(agents.length, latePeers, run));
  }

  /** Held agents are not part of the run yet: completion neither waits for them nor for their mail. */
  holds(name: string): boolean {
    return this.#held.some((agent) => agent.name === name);
  }

  /** Launches the held agents once; false when there were none left. */
  release(launch: (agent: RunAgent) => void): boolean {
    const released = this.#held;
    this.#held = [];
    released.forEach(launch);
    return released.length > 0;
  }
}

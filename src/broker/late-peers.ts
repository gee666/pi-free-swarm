// Late peers: the last agents of a fresh run are held back and join with the same prompts and a fresh
// context. An independent late look catches shared blind spots. All but the last join one by one as the
// early peers go quiet; the last is the final reserve and joins only once the whole launched swarm is quiet.
import { isSettled, type AgentLiveness } from "./lifecycle.js";

/** At least one agent always launches first; a lone agent and resumed runs have no late peers. */
export function lateCount(agentCount: number, ratio: number, run: number): number {
  if (run !== 1 || agentCount < 2 || ratio <= 0) return 0;
  return Math.min(Math.max(Math.round(agentCount * ratio), 1), agentCount - 1);
}

interface Peer {
  readonly name: string;
  liveness(): AgentLiveness;
}

export class LateReserve<Agent extends Peer> {
  readonly #early: readonly Agent[];
  /** Launch order; the last one is the final reserve. */
  readonly #late: readonly Agent[];
  #released = 0;

  /** `agents` in launch order; the last ones are held. */
  constructor(agents: readonly Agent[], ratio: number, run: number) {
    const split = agents.length - lateCount(agents.length, ratio, run);
    this.#early = agents.slice(0, split);
    this.#late = agents.slice(split);
  }

  /** Held agents are not part of the run yet: completion neither waits for them nor for their mail. */
  holds(name: string): boolean {
    return this.#late.slice(this.#released).some((agent) => agent.name === name);
  }

  /**
   * Called on every completion check; `runQuiet` = every launched agent is quiescent past the grace.
   * Rolling peers join as early peers settle; at a quiet point any still held join first, and the final
   * reserve only at a later one. false when nobody joined.
   */
  release(runQuiet: boolean, launch: (agent: Agent) => void): boolean {
    const settledEarly = this.#early.filter((agent) => isSettled(agent.liveness())).length;
    const before = this.#released;
    // Rolling peer i of L joins once ceil(i × E / L) of the E early peers are settled at the same time.
    while (
      this.#released < this.#late.length - 1 &&
      settledEarly >= Math.ceil(((this.#released + 1) * this.#early.length) / this.#late.length)
    ) {
      this.#launchNext(launch);
    }
    if (runQuiet && this.#released === before) this.#launchNext(launch);
    return this.#released > before;
  }

  #launchNext(launch: (agent: Agent) => void): void {
    const agent = this.#late[this.#released];
    if (agent === undefined) return;
    this.#released++;
    launch(agent);
  }
}

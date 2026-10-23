import type { AgentCrash } from "../agents/supervisor.js";
import { MAIN_NAME, WATCHER_NAME } from "../constants.js";
import { invalidateAgentVote } from "./acceptance.js";
import { reviveDelayMs } from "./lifecycle.js";
import type { LiveWorkers } from "./live-workers.js";
import type { RunAgent } from "./run-agent.js";
import type { RunEnvironment, RunTimings } from "./run-types.js";
import { SharedRecovery } from "./shared-recovery.js";
import type { StartupAdmission } from "./startup-admission.js";
import { createPost } from "./wall.js";

export class RunRecovery {
  readonly #shared = new SharedRecovery();
  constructor(
    readonly options: {
      env: RunEnvironment;
      swarmId: number;
      swarmName: string;
      run: number;
      timings: RunTimings;
      agents: Map<string, RunAgent>;
      admission: StartupAdmission;
      live: LiveWorkers;
      canContinue(): boolean;
    },
  ) {}

  ready(name: string): void {
    const agent = this.options.agents.get(name);
    if (!agent) return;
    this.options.admission.ready(agent);
    this.options.live.ready(agent);
    this.#shared.ready(name);
  }

  removed(agent: RunAgent): void {
    this.options.admission.remove(agent);
    this.#shared.remove(agent.name);
  }

  crashed(agent: RunAgent, crash: AgentCrash): void {
    const { env, swarmId, run, timings, agents, admission, live, canContinue } = this.options;
    if (agent.name === WATCHER_NAME || !canContinue() || !agents.has(agent.name)) return;
    invalidateAgentVote(env.db, swarmId, run, agent.name, `Voter crashed: ${crash.message}`, env.clock.now());
    if (live.crashed(agent, crash) || admission.crashed(agent, crash)) return;
    if (crash.fatal) {
      env.notifyUser(`Swarm "${this.options.swarmName}": ${agent.name} could not start. ${crash.message}`);
      this.#report(agent);
      return;
    }
    const delayMs = reviveDelayMs(agent.revivesThisRun, timings.reviveBackoffMs);
    if (delayMs === null) this.#report(agent);
    else if (crash.sharedFailure) {
      env.notifyUser(
        `Swarm "${this.options.swarmName}": coordinating ${crash.sharedFailure} recovery for ${agent.name}.`,
      );
      this.#shared.recover(`${agent.launchKey}:${crash.sharedFailure}`, agent.name, () => {
        if (canContinue() && agents.has(agent.name)) agent.scheduleRevive(delayMs);
      });
    } else agent.scheduleRevive(delayMs);
  }

  #report(agent: RunAgent): void {
    this.options.admission.isolatedFailure(agent);
    this.options.live.isolatedFailure(agent);
    for (const name of this.#shared.failed(agent.name)) {
      const waiting = this.options.agents.get(name);
      if (waiting) this.#report(waiting);
    }
    const text = `${agent.name} crashed and was not revived`;
    createPost(
      this.options.env.db,
      this.options.swarmId,
      MAIN_NAME,
      { title: `${agent.name} crashed`, text },
      this.options.env.clock.now(),
    );
  }

  close(): void {
    this.#shared.close();
  }
}

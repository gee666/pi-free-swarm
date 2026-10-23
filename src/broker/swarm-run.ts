// One SwarmRun per tool call holds the run lock until launch, delivery and completion finish.
import type { SwarmListItem } from "../api-types.js";
import { announceUserMessage } from "./messages.js";
import type { AgentCrash } from "../agents/supervisor.js";
import type { TimerHandle } from "../clock.js";
import { MAIN_NAME, WATCHER_NAME } from "../constants.js";
import { buildRunSpec } from "./run-spec.js";
import { configureRun } from "./run-configuration.js";
import { heartbeatRunLock } from "../store/locks.js";
import { getSwarm, listAgentSessions } from "../store/swarm-queries.js";
import { DeliveryLoop } from "./delivery.js";
import { RunResources } from "./run-resources.js";
import { RunLifecycle } from "./run-lifecycle.js";
import { readBudget, assertBudgetPricing } from "./budget.js";
import { RunBudget } from "./run-budget.js";
import { IdleReminders } from "./idle-reminder.js";
import { inspectAcceptance, invalidateAgentVote } from "./acceptance.js";
import { closeRunAdmission, prepareRunCompletion } from "./run-acceptance.js";
import type { AcceptanceRecord } from "../store/acceptance-types.js";
import { reviveDelayMs } from "./lifecycle.js";
import { RunAgent } from "./run-agent.js";
import { readRunProgress } from "./run-progress.js";
import { registerActiveRun } from "./active-ownership.js";
import { guardRunAction, bestEffortEnd, reportRunFailure } from "./run-failure.js";
import {
  DEFAULT_TIMINGS,
  type RunEnvironment,
  type RunOptions,
  type RunOutcome,
  type RunTimings,
} from "./run-types.js";
export type { RunEnvironment, RunOptions, RunOutcome, RunTimings } from "./run-types.js";
import { endRun, markSwarmRunning, type RunEndStatus } from "./swarms.js";
export { startSwarm, resumeSwarm } from "./run-entry.js";
import { createPost } from "./wall.js";
import { StartupAdmission } from "./startup-admission.js";
import { SharedRecovery } from "./shared-recovery.js";

import { registerRun, unregisterRun } from "./run-registry.js";
export { stopAllRuns } from "./run-registry.js";

export class SwarmRun {
  readonly #env: RunEnvironment;
  readonly #swarm: SwarmListItem;
  readonly #run: number;
  readonly #options: RunOptions;
  readonly #timings: RunTimings;
  readonly #agents = new Map<string, RunAgent>();
  readonly #resources = new RunResources();
  readonly #lifecycle = new RunLifecycle();
  readonly #budget: RunBudget;
  get #budgetStop(): boolean {
    return this.#budget.stopped;
  }
  readonly #delivery: DeliveryLoop;
  readonly #reminders: IdleReminders;
  readonly #admission: StartupAdmission;
  readonly #recovery = new SharedRecovery();
  #admittedWorkers = 0;
  readonly #done: Promise<RunOutcome>;
  #settle: { resolve(outcome: RunOutcome): void; reject(error: unknown): void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  #timers: TimerHandle[] = [];
  #releaseOwnership: (() => void) | undefined;
  #failure: { error: unknown } | undefined;
  #acceptance: AcceptanceRecord | undefined;
  readonly #fail = (error: unknown) => {
    if (this.#failure) return;
    this.#failure = { error };
    reportRunFailure(this.#env, this.#swarm.id);
    void this.#end("stopped");
  };
  #guard(action: () => void | Promise<void>): void {
    if (!this.#isEnding) guardRunAction(action, this.#fail);
  }
  /** Set before stopping so supervisor shutdown transitions do not overwrite final statuses. */
  get #isEnding(): boolean {
    return this.#lifecycle.ending;
  }
  #ending: Promise<void> | null = null;
  readonly #onAbort = () => void this.stop();

  constructor(env: RunEnvironment, swarm: SwarmListItem, run: number, options: RunOptions) {
    this.#env = env;
    this.#swarm = swarm;
    this.#run = run;
    this.#options = options;
    this.#timings = { ...DEFAULT_TIMINGS, ...env.timings };
    this.#done = new Promise((resolve, reject) => (this.#settle = { resolve, reject }));
    this.#admission = new StartupAdmission((candidate) => {
      const agent = this.#agents.get(candidate.name);
      if (agent) this.#launchFirst(agent);
    }, this.#fail);
    const { db, clock, settings } = env;
    const sessions = listAgentSessions(db, swarm.id);
    const assignments = configureRun(
      env,
      swarm.id,
      run,
      sessions.map(({ name }) => name),
      this.#timings,
    );
    assertBudgetPricing(env, assignments, swarm.id);
    for (const { name, sessionFile } of sessions) {
      const spec = buildRunSpec(env, swarm.id, name, sessionFile, run, assignments.get(name));
      const agent = new RunAgent(spec, {
        db,
        swarmId: swarm.id,
        swarmName: swarm.name,
        taskPrompt: swarm.taskPrompt,
        acceptanceCriteria: swarm.acceptanceCriteria,
        clock,
        watchdog: this.#timings.watchdog,
        collect: (agentName, includeDeliveredUnread) => this.#delivery.collect(agentName, includeDeliveredUnread),
        isEnding: () => this.#isEnding,
        canContinue: () => this.#lifecycle.admitsWork,
        onStatus: (name, status) => this.#reminders.statusChanged(name, status),
        onReady: (name) => {
          const agent = this.#agents.get(name);
          if (agent) this.#admission.ready(agent);
          this.#recovery.ready(name);
        },
        onRealMessage: (name) => this.#reminders.realMessage(name),
        onError: this.#fail,
        onCrash: (crashed, crash) => this.#onCrash(crashed, crash),
      });
      this.#agents.set(name, agent);
    }
    this.#delivery = new DeliveryLoop({
      db,
      swarmId: swarm.id,
      agents: this.#agents,
      clock,
      pollMs: this.#timings.deliveryPollMs,
      onError: this.#fail,
      onUserMessage: (message) => announceUserMessage(swarm.name, message, env.notifyUser),
    });
    this.#budget = new RunBudget(
      env,
      swarm.id,
      run,
      () => {
        this.#lifecycle.drain();
        this.#delivery.stop();
        this.#reminders.stop();
        if (env.settings.gracefulShutdownOnBudget) {
          for (const agent of this.#agents.values()) {
            const quiesced = agent.quiesce();
            this.#resources.add("join", () => quiesced);
          }
        }
      },
      () => [...this.#agents.values()].some((agent) => agent.status === "working" || agent.status === "starting"),
      () => {
        void this.#end("stopped");
      },
    );
    this.#reminders = new IdleReminders({
      db,
      swarmId: swarm.id,
      clock,
      settings,
      agents: this.#agents,
      onError: this.#fail,
    });
  }

  #workers(): RunAgent[] {
    return [...this.#agents.values()].filter((agent) => agent.name !== WATCHER_NAME);
  }

  execute(staggerMs: number): Promise<RunOutcome> {
    this.#lifecycle.activate();
    registerRun(this, this.#env.runOwner);
    this.#releaseOwnership = registerActiveRun(this.#env.db, this.#swarm.id, this.#env.runnerPid);
    this.#resources.add("quiesce", () => {
      for (const timer of this.#timers) timer.cancel();
      this.#timers = [];
      this.#delivery.stop();
      this.#reminders.stop();
      this.#options.signal?.removeEventListener("abort", this.#onAbort);
    });
    for (const agent of this.#agents.values()) this.#resources.add("join", () => agent.stop());
    this.#guard(() => {
      if (!this.#budget.check()) this.#start(staggerMs);
    });
    return this.#done;
  }

  #start(staggerMs: number): void {
    const { clock } = this.#env;
    for (const agent of this.#agents.values()) agent.writeSystemPrompt();
    const timings = this.#timings;
    this.#timers.push(clock.every(timings.heartbeatMs, () => this.#guard(() => this.#heartbeat())));
    this.#delivery.start();
    const watcher = this.#agents.get(WATCHER_NAME);
    if (watcher) this.#guard(() => watcher.launchFirst());
    const agents = this.#workers();
    agents.forEach((agent, index) => {
      this.#timers.push(clock.after(index * staggerMs, () => this.#guard(() => this.#admission.admit(agent))));
    });
    this.#timers.push(clock.every(timings.completionCheckMs, () => this.#guard(() => this.#checkCompletion())));
    this.#timers.push(clock.every(timings.progressMs, () => this.#guard(() => this.#reportProgress())));
    this.#reportProgress();
    const { signal } = this.#options;
    if (signal?.aborted) void this.stop();
    else signal?.addEventListener("abort", this.#onAbort, { once: true });
  }

  stop(): Promise<void> {
    return this.#end("stopped");
  }

  #launchFirst(agent: RunAgent): void {
    if (this.#isEnding || this.#budgetStop) return;
    this.#guard(() => agent.launchFirst());
    this.#admittedWorkers++;
    if (this.#admittedWorkers !== this.#workers().length) return;
    markSwarmRunning(this.#env.db, this.#swarm.id, this.#env.runnerPid, this.#env.clock.now(), this.#run);
  }

  #onCrash(agent: RunAgent, crash: AgentCrash): void {
    if (agent.name === WATCHER_NAME || this.#budgetStop) return;
    invalidateAgentVote(
      this.#env.db,
      this.#swarm.id,
      this.#run,
      agent.name,
      `Voter crashed: ${crash.message}`,
      this.#env.clock.now(),
    );
    if (this.#admission.crashed(agent, crash)) return;
    if (crash.fatal) {
      this.#env.notifyUser(`Swarm "${this.#swarm.name}": ${agent.name} could not start. ${crash.message}`);
      this.#reportCrash(agent);
      return;
    }
    const delayMs = reviveDelayMs(agent.revivesThisRun, this.#timings.reviveBackoffMs);
    if (delayMs === null) {
      this.#reportCrash(agent);
    } else if (crash.sharedFailure) {
      this.#env.notifyUser(
        `Swarm "${this.#swarm.name}": coordinating ${crash.sharedFailure} recovery for ${agent.name}.`,
      );
      this.#recovery.recover(`${agent.launchKey}:${crash.sharedFailure}`, agent.name, () => {
        if (!this.#isEnding) agent.scheduleRevive(delayMs);
      });
    } else {
      // Unknown failures keep individual retries; an existing shared group still waits for readiness.
      agent.scheduleRevive(delayMs);
    }
  }

  #reportCrash(agent: RunAgent): void {
    this.#admission.isolatedFailure(agent);
    for (const name of this.#recovery.failed(agent.name)) {
      const waiting = this.#agents.get(name);
      if (waiting) this.#reportCrash(waiting);
    }
    const text = `${agent.name} crashed and was not revived`;
    createPost(
      this.#env.db,
      this.#swarm.id,
      MAIN_NAME,
      { title: `${agent.name} crashed`, text },
      this.#env.clock.now(),
    );
  }

  #heartbeat(): void {
    const { db, runnerPid, clock } = this.#env;
    // Lost = a sweep already ended this run as interrupted; only the processes are left to stop.
    if (!heartbeatRunLock(db, this.#swarm.id, runnerPid, clock.now(), this.#run)) void this.#end("interrupted", true);
  }

  #checkCompletion(): void {
    if (this.#isEnding || this.#budget.check()) return;
    this.#reminders.update();
    const { db, runnerPid, clock } = this.#env;
    const decision = prepareRunCompletion(db, {
      swarmId: this.#swarm.id,
      run: this.#run,
      runnerPid,
      now: clock.now(),
    });
    if (decision.kind === "closed") {
      this.#acceptance = decision.acceptance;
      void this.#end("finished");
    } else if (decision.kind === "lost") void this.#end("interrupted", true);
  }

  #reportProgress(): void {
    const { db, clock } = this.#env;
    this.#options.onProgress?.(readRunProgress(db, this.#swarm.id, clock.now(), this.#env.boardUrl()));
  }

  #end(end: RunEndStatus, lockLost = false): Promise<void> {
    if (this.#ending) return this.#ending;
    this.#lifecycle.end();
    this.#ending = this.#shutDown(end, lockLost).then(
      (outcome) => (this.#failure ? this.#settle.reject(this.#failure.error) : this.#settle.resolve(outcome)),
      (error: unknown) => {
        if (!this.#failure) reportRunFailure(this.#env, this.#swarm.id);
        bestEffortEnd(this.#env, this.#swarm.id, this.#run);
        this.#settle.reject(this.#failure?.error ?? error);
      },
    );
    return this.#ending;
  }

  async #shutDown(end: RunEndStatus, lockLost: boolean): Promise<RunOutcome> {
    this.#admission.close();
    this.#recovery.close();
    try {
      const { db, runnerPid, clock } = this.#env;
      try {
        this.#acceptance ??=
          (!lockLost &&
            closeRunAdmission(db, {
              swarmId: this.#swarm.id,
              run: this.#run,
              runnerPid,
              now: clock.now(),
            })) ||
          inspectAcceptance(db, this.#swarm.id);
      } finally {
        await this.#resources.close();
      }
      const ended = !lockLost && endRun(db, this.#swarm.id, runnerPid, end, clock.now(), this.#run);
      this.#reportProgress();
      const swarm = getSwarm(db, this.#swarm.id, clock.now()) ?? this.#swarm;
      return {
        swarm,
        run: this.#run,
        end: ended ? end : "interrupted",
        acceptance: this.#acceptance,
        ...(this.#budgetStop ? { stopReason: "budget-exhausted" as const } : {}),
        budget: readBudget(db, this.#swarm.id, this.#env.settings, clock.now()),
      };
    } finally {
      unregisterRun(this);
      this.#releaseOwnership?.();
      this.#lifecycle.close();
    }
  }
}

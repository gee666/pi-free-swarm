// One SwarmRun per tool call holds the run lock until launch, delivery and completion finish.
import type { SwarmListItem } from "../api-types.js";
import type { TimerHandle } from "../clock.js";
import { WATCHER_NAME } from "../constants.js";
import { prepareRunRoster } from "./run-roster.js";
import { LiveWorkers } from "./live-workers.js";
import { RunControls } from "./run-controls.js";
import { RunCompletion } from "./run-completion.js";
import { onWorkChanged } from "./work-write.js";
import { runOutcome } from "./run-outcome.js";
import { RunRecovery } from "./run-recovery.js";
import { readRunOwnership } from "./run-ownership.js";
import { heartbeatRunLock } from "../store/locks.js";
import { DeliveryLoop } from "./delivery.js";
import { RunResources } from "./run-resources.js";
import { RunLifecycle } from "./run-lifecycle.js";
import { resetOrphanedReviews } from "./task-review.js";
import { RunBudget } from "./run-budget.js";
import { IdleReminders } from "./idle-reminder.js";
import { closeRunAdmission } from "./run-admission.js";
import { waitForActiveRun } from "./run-wait.js";
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
export { startSwarm, resumeSwarm, restartSwarm } from "./run-entry.js";
import { StartupAdmission } from "./startup-admission.js";

import { registerRun, unregisterRun } from "./run-registry.js";
export { stopAllRuns } from "./run-registry.js";

export class SwarmRun {
  readonly #env: RunEnvironment;
  readonly #swarm: SwarmListItem;
  readonly #run: number;
  readonly #options: RunOptions;
  readonly #timings: RunTimings;
  readonly #agents: Map<string, RunAgent>;
  readonly #resources = new RunResources();
  readonly #lifecycle = new RunLifecycle();
  readonly #budget: RunBudget;
  get #budgetStop(): boolean {
    return this.#budget.stopped;
  }
  readonly #delivery: DeliveryLoop;
  readonly #reminders: IdleReminders;
  readonly #admission: StartupAdmission;
  readonly #recovery: RunRecovery;
  readonly #liveWorkers: LiveWorkers;
  readonly #controls: RunControls;
  readonly #completion: RunCompletion;
  readonly #admittedWorkers = new Set<string>();
  readonly #done: Promise<RunOutcome>;
  #settle: { resolve(outcome: RunOutcome): void; reject(error: unknown): void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  #timers: TimerHandle[] = [];
  #releaseOwnership: (() => void) | undefined;
  #failure: { error: unknown } | undefined;
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
  #requestedEnd: RunEndStatus | undefined;
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
    const { agents, create } = prepareRunRoster(
      env,
      swarm,
      run,
      this.#timings,
      {
        collect: (name, includeDeliveredUnread) => this.#delivery.collect(name, includeDeliveredUnread),
        isEnding: () => this.#isEnding,
        canContinue: () => this.#canRun(true),
        onStatus: (name, status) => this.#reminders.statusChanged(name, status),
        onReady: (name) => this.#recovery.ready(name),
        onRealMessage: (name) => this.#reminders.realMessage(name),
        onError: this.#fail,
        onCrash: (agent, crash) => this.#recovery.crashed(agent, crash),
      },
      options.restart,
    );
    this.#agents = agents;
    this.#liveWorkers = new LiveWorkers(env, swarm.id, this.#agents, this.#resources, {
      create,
      launch: (agent) => this.#launchFirst(agent),
      removed: (agent) => {
        this.#admittedWorkers.delete(agent.name);
        this.#recovery.removed(agent);
      },
      changed: () => this.#markRunning(),
      canContinue: () => this.#canRun(true),
      onError: this.#fail,
    });
    this.#recovery = new RunRecovery({
      env,
      swarmId: swarm.id,
      swarmName: swarm.name,
      run,
      timings: this.#timings,
      agents: this.#agents,
      admission: this.#admission,
      live: this.#liveWorkers,
      canContinue: () => this.#canRun(true),
    });
    this.#controls = new RunControls(env, swarm.id, run, this.#liveWorkers, () => this.#canRun(true));
    this.#delivery = new DeliveryLoop({
      db,
      swarmId: swarm.id,
      agents: this.#agents,
      clock,
      pollMs: this.#timings.deliveryPollMs,
      onError: this.#fail,
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
    this.#completion = new RunCompletion({
      env,
      swarmId: swarm.id,
      run,
      controls: this.#controls,
      reminders: this.#reminders,
      canRun: () => this.#canRun(),
      ending: () => this.#isEnding,
      closed: () => {
        void this.#end(this.#budgetStop ? "stopped" : "finished");
      },
      lost: () => {
        void this.#end("interrupted", true);
      },
    });
  }

  #workers(): RunAgent[] {
    return [...this.#agents.values()].filter((agent) => agent.name !== WATCHER_NAME);
  }

  execute(staggerMs: number): Promise<RunOutcome> {
    resetOrphanedReviews(this.#env.db, this.#swarm.id, this.#env.clock.now());
    this.#lifecycle.activate();
    const removeWorkListener = onWorkChanged((id) => {
      if (id === this.#swarm.id) this.#guard(() => this.#completion.check());
    });
    this.#resources.add("quiesce", removeWorkListener);
    registerRun(this, this.#env.runOwner);
    this.#releaseOwnership = registerActiveRun(this.#env.db, this.#swarm.id, this.#env.runnerPid);
    this.#resources.add("quiesce", () => {
      for (const timer of this.#timers) timer.cancel();
      this.#timers = [];
      this.#delivery.stop();
      this.#reminders.stop();
      this.#options.signal?.removeEventListener("abort", this.#onAbort);
      this.#liveWorkers.close();
      this.#controls.quiesce();
    });
    this.#resources.add("join", () => this.#controls.close());
    for (const agent of this.#agents.values()) this.#liveWorkers.register(agent);
    this.#guard(() => {
      if (this.#canRun(true)) this.#start(staggerMs);
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
      this.#timers.push(
        clock.after(index * staggerMs, () =>
          this.#guard(() => {
            if (this.#agents.get(agent.name) === agent) this.#admission.admit(agent);
          }),
        ),
      );
    });
    this.#timers.push(clock.every(timings.completionCheckMs, () => this.#guard(() => this.#completion.check())));
    this.#timers.push(clock.every(timings.progressMs, () => this.#guard(() => this.#reportProgress())));
    this.#reportProgress();
    const { signal } = this.#options;
    if (signal?.aborted) void this.stop();
    else signal?.addEventListener("abort", this.#onAbort, { once: true });
  }

  get dbPath(): string {
    return this.#env.db.path;
  }
  get swarmId(): number {
    return this.#swarm.id;
  }

  wait(options: RunOptions): Promise<RunOutcome> {
    return waitForActiveRun(this.#env, this.swarmId, this.#timings.progressMs, this.#done, options, () => this.stop());
  }

  stop(): Promise<void> {
    return this.#end("stopped");
  }

  #launchFirst(agent: RunAgent): void {
    if (this.#agents.get(agent.name) !== agent || !this.#canRun(true)) return;
    this.#guard(() => agent.launchFirst());
    this.#admittedWorkers.add(agent.name);
    this.#markRunning();
  }

  #markRunning(): void {
    if (this.#isEnding || this.#workers().some((agent) => !this.#admittedWorkers.has(agent.name))) return;
    markSwarmRunning(this.#env.db, this.#swarm.id, this.#env.runnerPid, this.#env.clock.now(), this.#run);
  }

  #heartbeat(): void {
    const { db, runnerPid, clock } = this.#env;
    // Lost = a sweep already ended this run as interrupted; only the processes are left to stop.
    if (!heartbeatRunLock(db, this.#swarm.id, runnerPid, clock.now(), this.#run)) void this.#end("interrupted", true);
  }

  #canRun(admit = false): boolean {
    if (this.#isEnding) return false;
    const ownership = readRunOwnership(this.#env.db, this.#swarm.id, this.#run, this.#env.runnerPid);
    if (ownership === "lost") {
      void this.#end("interrupted", true);
      return false;
    }
    if (admit && (!this.#lifecycle.admitsWork || ownership === "closed")) return false;
    return !this.#budget.check();
  }

  #reportProgress(): void {
    const { db, clock } = this.#env;
    this.#options.onProgress?.(readRunProgress(db, this.#swarm.id, clock.now(), this.#env.boardUrl()));
  }

  #end(end: RunEndStatus, lockLost = false): Promise<void> {
    if (end !== "finished") this.#requestedEnd = end;
    if (this.#ending) return this.#ending;
    this.#lifecycle.end();
    this.#ending = this.#shutDown(end, lockLost)
      .then((outcome) => outcome ?? new SwarmRun(this.#env, this.#swarm, this.#run, this.#options).execute(0))
      .then(
        (outcome) => (this.#failure ? this.#settle.reject(this.#failure.error) : this.#settle.resolve(outcome)),
        (error: unknown) => {
          if (!this.#failure) reportRunFailure(this.#env, this.#swarm.id);
          bestEffortEnd(this.#env, this.#swarm.id, this.#run);
          this.#settle.reject(this.#failure?.error ?? error);
        },
      );
    return this.#ending;
  }

  async #shutDown(end: RunEndStatus, lockLost: boolean): Promise<RunOutcome | null> {
    this.#admission.close();
    this.#recovery.close();
    try {
      const { db, runnerPid, clock } = this.#env;
      try {
        if (!lockLost) closeRunAdmission(db, this.#swarm.id, this.#run, runnerPid);
      } finally {
        await this.#resources.close();
      }
      end = this.#requestedEnd ?? end;
      const ended = !lockLost && endRun(db, this.#swarm.id, runnerPid, end, clock.now(), this.#run);
      if (!ended && end === "finished" && readRunOwnership(db, this.#swarm.id, this.#run, runnerPid) === "owned")
        return null;
      this.#reportProgress();
      return runOutcome(this.#env, this.#swarm, this.#run, end, ended, this.#budgetStop);
    } finally {
      unregisterRun(this);
      this.#releaseOwnership?.();
      this.#lifecycle.close();
    }
  }
}

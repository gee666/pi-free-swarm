// The runner behind the swarm and resume_swarm tools (plan §6.1, §7): holds the run lock, launches and
// revives agents, delivers messages and detects the end. One SwarmRun per tool call.
import * as path from "node:path";
import type { MessageView, SwarmListItem } from "../api-types.js";
import type { AgentCrash } from "../agents/supervisor.js";
import type { WatchdogConfig } from "../agents/watchdog.js";
import type { Clock, TimerHandle } from "../clock.js";
import {
  COMPLETION_CHECK_MS,
  COMPLETION_GRACE_MS,
  DELIVERY_POLL_MS,
  MAIN_NAME,
  PROGRESS_UPDATE_MS,
  RESUME_STAGGER_MS,
  REVIVE_BACKOFF_MS,
  RUN_LOCK_HEARTBEAT_MS,
  SYSTEM_PROMPT_FILE,
} from "../constants.js";
import { pickAgentNames } from "../names.js";
import type { AgentLaunchContext } from "../runtime-types.js";
import { buildAgentEnv, type SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import { heartbeatRunLock } from "../store/locks.js";
import { listOpenAgentRecipients } from "../store/message-queries.js";
import { getSwarm, listAgentSessions } from "../store/swarm-queries.js";
import { DeliveryLoop } from "./delivery.js";
import { CompletionTracker, reviveDelayMs } from "./lifecycle.js";
import { sendMainFeedback } from "./messages.js";
import { RunAgent } from "./run-agent.js";
import { readRunProgress, type RunProgress } from "./run-progress.js";
import { beginResume, createSwarm, endRun, markSwarmRunning, type RunEndStatus } from "./swarms.js";
import { createPost } from "./wall.js";

/** Every delay of a run; production uses the constants, tests shrink them. */
export interface RunTimings {
  heartbeatMs: number;
  deliveryPollMs: number;
  completionCheckMs: number;
  completionGraceMs: number;
  progressMs: number;
  resumeStaggerMs: number;
  reviveBackoffMs: readonly number[];
  /** Undefined = watchdogConfigFromEnv(). */
  watchdog?: WatchdogConfig;
}

const DEFAULT_TIMINGS: RunTimings = {
  heartbeatMs: RUN_LOCK_HEARTBEAT_MS,
  deliveryPollMs: DELIVERY_POLL_MS,
  completionCheckMs: COMPLETION_CHECK_MS,
  completionGraceMs: COMPLETION_GRACE_MS,
  progressMs: PROGRESS_UPDATE_MS,
  resumeStaggerMs: RESUME_STAGGER_MS,
  reviveBackoffMs: REVIVE_BACKOFF_MS,
};

export interface RunEnvironment {
  cwd: string;
  db: SwarmDb;
  runnerPid: number;
  clock: Clock;
  /** Snapshot for the whole run, revives included. */
  settings: SwarmSettings;
  /** Captured at tool execution, reused for revives. */
  launch: AgentLaunchContext;
  boardUrl(): string | null;
  /** ctx.ui.notify when available. */
  notifyUser(text: string): void;
  timings?: Partial<RunTimings>;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?(progress: RunProgress): void;
}

export interface RunOutcome {
  swarm: SwarmListItem;
  run: number;
  end: RunEndStatus;
}

function timingsOf(env: RunEnvironment): RunTimings {
  return { ...DEFAULT_TIMINGS, ...env.timings };
}

const activeRuns = new Set<SwarmRun>();

class SwarmRun {
  readonly #env: RunEnvironment;
  readonly #swarm: SwarmListItem;
  readonly #run: number;
  readonly #options: RunOptions;
  readonly #timings: RunTimings;
  readonly #agents = new Map<string, RunAgent>();
  readonly #delivery: DeliveryLoop;
  readonly #tracker: CompletionTracker;
  readonly #done: Promise<RunOutcome>;
  #settle: { resolve(outcome: RunOutcome): void; reject(error: unknown): void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  #timers: TimerHandle[] = [];
  #allLaunched = false;
  /** Set before anything stops, so the stop transitions of the supervisors are not written. */
  #isEnding = false;
  #ending: Promise<void> | null = null;
  readonly #onAbort = () => void this.stop();

  constructor(env: RunEnvironment, swarm: SwarmListItem, run: number, options: RunOptions) {
    this.#env = env;
    this.#swarm = swarm;
    this.#run = run;
    this.#options = options;
    this.#timings = timingsOf(env);
    this.#done = new Promise((resolve, reject) => (this.#settle = { resolve, reject }));
    const { db, clock, settings, runnerPid } = env;
    for (const { name, sessionFile } of listAgentSessions(db, swarm.id)) {
      const spec = {
        name,
        cwd: env.cwd,
        sessionFile,
        systemPromptFile: path.join(path.dirname(sessionFile), SYSTEM_PROMPT_FILE),
        context: env.launch,
        env: buildAgentEnv(settings, { dbPath: db.path, swarmId: swarm.id, agentName: name, runnerPid }),
      };
      const agent = new RunAgent(spec, {
        db,
        swarmId: swarm.id,
        swarmName: swarm.name,
        taskPrompt: swarm.taskPrompt,
        clock,
        watchdog: this.#timings.watchdog,
        collect: (agentName, includeDeliveredUnread) => this.#delivery.collect(agentName, includeDeliveredUnread),
        isEnding: () => this.#isEnding,
        onWorking: () => this.#tracker.reset(),
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
      onUserMessage: (message) => this.#announce(message),
    });
    this.#tracker = new CompletionTracker(clock, this.#timings.completionGraceMs);
  }

  /** Agent `i` launches at `i × staggerMs`. Resolves when the run has ended. */
  execute(staggerMs: number): Promise<RunOutcome> {
    activeRuns.add(this);
    const { clock } = this.#env;
    try {
      for (const agent of this.#agents.values()) agent.writeSystemPrompt();
    } catch (error) {
      this.#settle.reject(error);
      void this.#end("stopped");
      return this.#done;
    }
    const timings = this.#timings;
    this.#timers.push(clock.every(timings.heartbeatMs, () => this.#heartbeat()));
    this.#delivery.start();
    const agents = [...this.#agents.values()];
    agents.forEach((agent, index) => {
      const isLast = index === agents.length - 1;
      this.#timers.push(clock.after(index * staggerMs, () => this.#launchFirst(agent, isLast)));
    });
    this.#timers.push(clock.every(timings.completionCheckMs, () => this.#checkCompletion()));
    this.#timers.push(clock.every(timings.progressMs, () => this.#reportProgress()));
    this.#reportProgress();
    const { signal } = this.#options;
    if (signal?.aborted) void this.stop();
    else signal?.addEventListener("abort", this.#onAbort, { once: true });
    return this.#done;
  }

  stop(): Promise<void> {
    return this.#end("stopped");
  }

  #launchFirst(agent: RunAgent, isLast: boolean): void {
    if (this.#isEnding) return;
    void agent.launchFirst();
    if (!isLast) return;
    this.#allLaunched = true;
    markSwarmRunning(this.#env.db, this.#swarm.id, this.#env.runnerPid, this.#env.clock.now());
  }

  #onCrash(agent: RunAgent, crash: AgentCrash): void {
    if (crash.fatal) {
      this.#env.notifyUser(`Swarm "${this.#swarm.name}": ${agent.name} could not start. ${crash.message}`);
      this.#giveUp(agent);
      return;
    }
    const delayMs = reviveDelayMs(agent.revivesThisRun, this.#timings.reviveBackoffMs);
    if (delayMs === null) this.#giveUp(agent);
    else agent.scheduleRevive(delayMs);
  }

  #giveUp(agent: RunAgent): void {
    agent.giveUp();
    const text = `${agent.name} crashed and was not revived`;
    createPost(
      this.#env.db,
      this.#swarm.id,
      MAIN_NAME,
      { title: `${agent.name} crashed`, text },
      this.#env.clock.now(),
    );
  }

  #announce(message: MessageView): void {
    if (message.senderKind !== "agent") return;
    this.#env.notifyUser(`Swarm "${this.#swarm.name}": ${message.sender} → User: ${message.text}`);
  }

  #heartbeat(): void {
    const { db, runnerPid, clock } = this.#env;
    // Lost = a sweep already ended this run as interrupted; only the processes are left to stop.
    if (!heartbeatRunLock(db, this.#swarm.id, runnerPid, clock.now())) void this.#end("interrupted", true);
  }

  #checkCompletion(): void {
    if (this.#isEnding) return;
    const agents = [...this.#agents.values()];
    const givenUp = new Set(agents.filter((agent) => agent.exhausted).map((agent) => agent.name));
    const openRecipients = listOpenAgentRecipients(this.#env.db, this.#swarm.id).filter(
      (open) => !givenUp.has(open.name),
    ).length;
    const quiet = this.#tracker.update({
      allLaunched: this.#allLaunched,
      agents: agents.map((agent) => agent.liveness()),
      openRecipients,
    });
    if (quiet) void this.#end("finished");
  }

  #reportProgress(): void {
    const { db, clock } = this.#env;
    this.#options.onProgress?.(readRunProgress(db, this.#swarm.id, clock.now(), this.#env.boardUrl()));
  }

  #end(end: RunEndStatus, lockLost = false): Promise<void> {
    if (this.#ending) return this.#ending;
    this.#isEnding = true;
    this.#ending = this.#shutDown(end, lockLost).then(
      (outcome) => this.#settle.resolve(outcome),
      (error: unknown) => this.#settle.reject(error),
    );
    return this.#ending;
  }

  async #shutDown(end: RunEndStatus, lockLost: boolean): Promise<RunOutcome> {
    for (const timer of this.#timers) timer.cancel();
    this.#timers = [];
    this.#delivery.stop();
    this.#options.signal?.removeEventListener("abort", this.#onAbort);
    try {
      await Promise.all([...this.#agents.values()].map((agent) => agent.stop()));
      const { db, runnerPid, clock } = this.#env;
      const ended = !lockLost && endRun(db, this.#swarm.id, runnerPid, end, clock.now());
      this.#reportProgress();
      const swarm = getSwarm(db, this.#swarm.id, clock.now()) ?? this.#swarm;
      return { swarm, run: this.#run, end: ended ? end : "interrupted" };
    } finally {
      activeRuns.delete(this);
    }
  }
}

/** Creates the swarm (claiming its run lock in the same transaction) and blocks until the run ends. */
export async function startSwarm(
  env: RunEnvironment,
  input: { name: string; taskPrompt: string; agentAmount: number },
  options: RunOptions,
): Promise<RunOutcome> {
  const agentNames = pickAgentNames(input.agentAmount);
  const { db, runnerPid, clock } = env;
  const swarm = createSwarm(db, {
    name: input.name,
    taskPrompt: input.taskPrompt,
    agentNames,
    runnerPid,
    now: clock.now(),
  });
  return new SwarmRun(env, swarm, 1, options).execute(env.settings.staggerSeconds * 1000);
}

/**
 * Claims the lock, posts Main's feedback and relaunches every agent on its own session. Throws
 * `swarm_running` while another fresh lock holds it; the feedback is validated in the same transaction.
 */
export async function resumeSwarm(
  env: RunEnvironment,
  input: { swarmId: number; message: string },
  options: RunOptions,
): Promise<RunOutcome> {
  const { db, runnerPid, clock } = env;
  const { swarm, run } = db.write(() => {
    const resumed = beginResume(db, input.swarmId, runnerPid, clock.now());
    sendMainFeedback(db, input.swarmId, input.message, clock.now());
    return resumed;
  });
  return new SwarmRun(env, swarm, run, options).execute(timingsOf(env).resumeStaggerMs);
}

/** For session_shutdown: stops every run of this process (SIGTERM, SIGKILL after 5 s). */
export async function stopAllRuns(): Promise<void> {
  await Promise.all([...activeRuns].map((run) => run.stop()));
}

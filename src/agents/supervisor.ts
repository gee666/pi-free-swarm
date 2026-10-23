// Drives one agent's pi process through pending → starting → working ⇄ idle → crashed | stopped.
// DB-free: everything the runner records arrives through SupervisorHooks.
import type { AgentActivity, ParticipantStatus } from "../api-types.js";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { STARTUP_RETRY_BASE_BACKOFF_MS } from "../constants.js";
import { classifyTransportExit } from "./exit-classification.js";
import type {
  AgentCrash,
  DeliveryOutcome,
  PromptPayload,
  SupervisorHooks,
  WorkerLife as Life,
} from "./supervisor-types.js";
export type { AgentCrash, DeliveryOutcome, PromptPayload, SupervisorHooks } from "./supervisor-types.js";
import type { AgentExitInfo } from "./agent-process.js";
import { spawnAgentTransport, type AgentTransport, type AgentTransportFactory } from "./transport.js";
import type { AgentLaunchSpec } from "./launch.js";
import { createProtocolHandler } from "./protocol.js";
import { PostObservation } from "./post-observation.js";
import { dialogRequestId, type RpcRecord } from "./rpc-events.js";
import { MessageObservation } from "./message-observation.js";
import { StallWatchdog, watchdogConfigFromEnv, type WatchdogConfig } from "./watchdog.js";

export class AgentSupervisor {
  readonly name: string;
  readonly #hooks: SupervisorHooks;
  readonly #clock: Clock;
  readonly #config: WatchdogConfig;
  readonly #transportFactory: AgentTransportFactory;
  #status: ParticipantStatus = "pending";
  #quiescing = false;
  #life: Life | null = null;
  #launch: { spec: AgentLaunchSpec; prompt: PromptPayload | null; retriesUsed: number } | null = null;
  #resolveLaunch: ((outcome: DeliveryOutcome) => void) | null = null;
  #retryTimer: TimerHandle | undefined;
  #activityKey = "null";
  #deliveryTail: Promise<unknown> = Promise.resolve();
  #stopped: Promise<void> | null = null;

  constructor(options: {
    name: string;
    hooks: SupervisorHooks;
    clock?: Clock;
    watchdog?: WatchdogConfig;
    transportFactory?: AgentTransportFactory;
  }) {
    this.name = options.name;
    this.#hooks = options.hooks;
    this.#clock = options.clock ?? systemClock;
    this.#config = options.watchdog ?? watchdogConfigFromEnv();
    this.#transportFactory = options.transportFactory ?? spawnAgentTransport;
  }

  get status(): ParticipantStatus {
    return this.#status;
  }

  /** Null prompt boots idle without a model call; otherwise resolves with the prompt's outcome. */
  launch(spec: AgentLaunchSpec, prompt: PromptPayload | null): Promise<DeliveryOutcome> {
    if (this.#quiescing || this.#stopped || (this.#status !== "pending" && this.#status !== "crashed")) {
      return Promise.resolve({ accepted: false, error: `${this.name} is ${this.#status}.` });
    }
    this.#launch = { spec, prompt, retriesUsed: 0 };
    this.#setStatus("starting");
    return new Promise((resolve) => {
      this.#resolveLaunch = resolve;
      void this.#spawn();
    });
  }

  /** Only while working|idle. Queued as steering while working, starts a run while idle. */
  deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
    const life = this.#life;
    return this.#serialize(() =>
      life === this.#life
        ? this.#deliver(prompt)
        : Promise.resolve({ accepted: false, error: `${this.name} was replaced.` }),
    );
  }

  recoverUnread(prompt: PromptPayload): Promise<DeliveryOutcome> {
    const life = this.#life;
    return this.#serialize(async () => {
      if (!life || life !== this.#life || this.#quiescing || this.#stopped || this.#status !== "idle") {
        return { accepted: false, error: `${this.name} is ${this.#status}.` };
      }
      life.promptsInFlight++;
      life.watchdog.rearm();
      try {
        const response = await life.proc.send({ type: "clear_queue" });
        if (response.success !== true) {
          life.watchdog.disarm();
          return { accepted: false, error: "Could not clear the steering queue." };
        }
        if (life !== this.#life || this.#stopped) return { accepted: false, error: `${this.name} exited.` };
        return (await this.#sendPrompt(life, prompt)) ?? { accepted: false, error: `${this.name} exited.` };
      } catch (error) {
        return { accepted: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        life.promptsInFlight--;
        if (life.promptsInFlight === 0 && life.deferredSettle) {
          life.deferredSettle = false;
          this.#applySettle(life);
        }
      }
    });
  }

  #serialize(operation: () => Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
    const result = this.#deliveryTail.then(operation);
    this.#deliveryTail = result.catch(() => undefined);
    return result;
  }

  async #deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
    const life = this.#life;
    if (!life || this.#quiescing || this.#stopped || (this.#status !== "working" && this.#status !== "idle")) {
      return { accepted: false, error: `${this.name} is ${this.#status}.` };
    }
    return (await this.#sendPrompt(life, prompt)) ?? { accepted: false, error: `${this.name} exited.` };
  }

  /** Keep the active turn, but remove accepted steering so it cannot start later work. */
  async quiesce(): Promise<void> {
    this.#quiescing = true;
    const life = this.#life;
    if (!life) return;
    if (this.#status === "starting") return this.stop();
    try {
      const response = await life.proc.send({ type: "clear_queue" });
      if (response.success !== true && life === this.#life) await this.stop();
    } catch {
      if (life === this.#life) await this.stop();
    }
  }

  /** → stopped (crashed stays crashed): SIGTERM the group, SIGKILL after 5 s; resolves once gone. Idempotent. */
  stop(): Promise<void> {
    if (!this.#stopped) {
      this.#retryTimer?.cancel();
      const life = this.#life;
      this.#stopped = life ? Promise.resolve().then(() => life.proc.stop()) : Promise.resolve();
      life?.watchdog.disarm();
      if (this.#status !== "crashed") this.#setStatus("stopped");
      this.#settleLaunch({ accepted: false, error: `${this.name} was stopped.` });
    }
    return this.#stopped;
  }

  async #spawn(): Promise<void> {
    const launch = this.#launch;
    if (!launch || this.#stopped) return;
    // Events and exits only arrive asynchronously, after `life` is assigned below.
    let life: Life;
    let proc: AgentTransport;
    try {
      proc = this.#transportFactory(
        launch.spec,
        { onEvent: (event) => this.#onEvent(life, event), onExit: (info) => this.#onExit(life, info) },
        this.#clock,
      );
    } catch (error) {
      // A bad command override throws before any child exists.
      const message = error instanceof Error ? error.message : String(error);
      this.#crash({ reason: "spawn_error", fatal: false, message, exitCode: null, signal: null, stderrTail: "" });
      return;
    }
    const watchdog = new StallWatchdog(this.#config, this.#clock, (kind, message) => {
      life.stall = { kind, message };
      void proc.stop();
    });
    const handle = createProtocolHandler(watchdog, {
      onRunStart: () => {
        life.runStarts++;
        if (life.runStarts === 1) this.#hooks.onReady?.();
        life.deferredSettle = false;
        this.#setStatus("working");
      },
      onSettled: () => {
        // Settle gap: a stale agent_settled can arrive between a prompt and its response.
        if (life.promptsInFlight > 0) life.deferredSettle = true;
        else this.#applySettle(life);
      },
      onUserMessage: (text) => {
        const ids = life.messages.observed(text);
        if (ids.length > 0) this.#hooks.onMessagesRead(ids);
        const postIds = life.posts.observed(text);
        if (postIds.length) this.#hooks.onPostsRead?.(postIds);
      },
      onUsage: (sample) => this.#hooks.onUsage(sample),
      onActivity: (activity) => this.#setActivity(activity),
    });
    life = {
      proc,
      watchdog,
      handle,
      stall: null,
      promptsInFlight: 0,
      deferredSettle: false,
      runStarts: 0,
      posts: new PostObservation(),
      messages: new MessageObservation(),
    };
    this.#life = life;
    watchdog.armStartup();

    // pi handles commands concurrently; the mode must be set before the prompt can queue anything.
    const steering = await proc.send({ type: "set_steering_mode", mode: "all" }).catch(() => null);
    if (!steering || life !== this.#life || this.#stopped) return;
    if (steering.success !== true) {
      watchdog.disarm();
      this.#crash({
        reason: "prompt_rejected",
        fatal: true,
        sharedStartupFailure: "steering-mode",
        message: "Could not configure native all-queued steering mode.",
        exitCode: null,
        signal: null,
        stderrTail: "",
      });
      void proc.stop();
      return;
    }
    const outcome = launch.prompt === null ? null : await this.#sendPrompt(life, launch.prompt);
    if (this.#stopped || (!outcome && launch.prompt !== null)) return;
    if (!outcome || (!outcome.accepted && outcome.withdrawn)) {
      watchdog.disarm();
      this.#setStatus("idle");
      this.#settleLaunch(outcome ?? { accepted: true });
      return;
    }
    if (outcome.accepted) {
      this.#settleLaunch(outcome);
      return;
    }
    // Deterministic (e.g. no usable model), so a revive would fail the same way.
    watchdog.disarm();
    const message = `The launch prompt was rejected: ${outcome.error}`;
    this.#crash({ reason: "prompt_rejected", fatal: true, message, exitCode: null, signal: null, stderrTail: "" });
    void proc.stop();
  }

  /** null when the process exited before answering; the exit path reports that. */
  async #sendPrompt(life: Life, prompt: PromptPayload): Promise<DeliveryOutcome | null> {
    if (prompt.beforeSend) {
      const refreshed = prompt.beforeSend();
      if (!refreshed)
        return { accepted: false, withdrawn: true, error: "The pending payload was withdrawn before sending." };
      prompt = refreshed;
    }
    if (life !== this.#life || this.#stopped || this.#quiescing) return null;
    life.promptsInFlight++;
    const runStarts = life.runStarts;
    const token = life.messages.sent(prompt.messageIds);
    life.posts.sent(prompt.text, prompt.postIds);
    try {
      const response = await life.proc.send({ type: "prompt", message: prompt.text, streamingBehavior: "steer" });
      if (life !== this.#life || this.#stopped) return null;
      if (response.success !== true) {
        life.posts.rejected(prompt.text);
        life.messages.rejected(token);
        return { accepted: false, error: typeof response.error === "string" ? response.error : "Prompt rejected." };
      }
      // A fast new turn can settle in the same batch as its prompt response.
      if (life.runStarts === runStarts) life.deferredSettle = false;
      life.watchdog.rearm();
      return { accepted: true };
    } catch {
      return null;
    } finally {
      life.promptsInFlight--;
      if (life.promptsInFlight === 0 && life.deferredSettle) {
        life.deferredSettle = false;
        this.#applySettle(life);
      }
    }
  }

  #onEvent(life: Life, event: RpcRecord): void {
    if (life !== this.#life || this.#stopped || this.#status === "crashed") return;
    const dialogId = dialogRequestId(event);
    if (dialogId) life.proc.write({ type: "extension_ui_response", id: dialogId, cancelled: true });
    // Dialogs included: every record is liveness for the watchdog.
    life.handle(event);
  }

  #applySettle(life: Life): void {
    if (life === this.#life && this.#status === "working") {
      life.watchdog.disarm();
      // Unobserved content stays durable and can be recovered; settled turns need no retained proof strings.
      life.posts.settled();
      life.messages.settled();
      if (this.#launch) this.#launch.prompt = null;
      this.#setStatus("idle");
    }
  }

  #onExit(life: Life, info: AgentExitInfo): void {
    if (life !== this.#life) return;
    this.#life = null;
    life.watchdog.disarm();
    if (this.#stopped || this.#status === "crashed") return;
    const launch = this.#launch;
    const common = { exitCode: info.code, signal: info.signal, stderrTail: info.stderrTail };
    const classified = classifyTransportExit(info, this.#status === "starting");
    if (classified) this.#crash(classified);
    else if (life.stall?.kind === "startup" && launch && launch.retriesUsed < this.#config.startupRetries) {
      // Almost always a transient cold-start stall: respawn a clean child, staying `starting`.
      const backoffMs = STARTUP_RETRY_BASE_BACKOFF_MS * 2 ** launch.retriesUsed;
      launch.retriesUsed++;
      this.#retryTimer = this.#clock.after(backoffMs, () => void this.#spawn());
    } else if (life.stall) {
      const reason = life.stall.kind === "startup" ? "startup_timeout" : "inactivity";
      this.#crash({ ...common, reason, fatal: false, message: life.stall.message });
    } else {
      const how = info.signal ? `from signal ${info.signal}` : `with code ${info.code ?? "null"}`;
      this.#crash({ ...common, reason: "exit", fatal: false, message: `Agent process exited ${how}.` });
    }
  }

  #crash(crash: AgentCrash): void {
    this.#setStatus("crashed");
    this.#hooks.onCrash(crash);
    this.#settleLaunch({ accepted: false, error: crash.message });
  }

  #settleLaunch(outcome: DeliveryOutcome): void {
    const resolve = this.#resolveLaunch;
    this.#resolveLaunch = null;
    resolve?.(outcome);
  }

  #setStatus(status: ParticipantStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    if (status !== "working") this.#activityKey = "null";
    this.#hooks.onStatus(status);
  }

  #setActivity(activity: AgentActivity | null): void {
    const key = JSON.stringify(activity);
    if (key === this.#activityKey) return;
    this.#activityKey = key;
    this.#hooks.onActivity(activity);
  }
}

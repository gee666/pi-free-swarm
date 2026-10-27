// One agent within one run: its supervisor, launch prompts and revive state. The run decides the policy.
import * as fs from "node:fs";
import * as path from "node:path";
import { WATCHER_NAME } from "../constants.js";
import { buildWatcherPrompt } from "../agents/watcher-prompt.js";
import type { ParticipantStatus } from "../api-types.js";
import { hasSessionFile, type AgentLaunchSpec } from "../agents/launch.js";
import { buildKickoffPrompt, buildResumePrompt, buildRevivePrompt, buildSystemPrompt } from "../agents/prompt.js";
import { AgentSupervisor, type AgentCrash, type DeliveryOutcome, type PromptPayload } from "../agents/supervisor.js";
import type { WatchdogConfig } from "../agents/watchdog.js";
import type { Clock, TimerHandle } from "../clock.js";
import type { ModelSelection } from "../runtime-types.js";
import type { SwarmDb } from "../store/db.js";
import { createAgentHooks } from "./agent-hooks.js";
import { readProject } from "./project.js";
import { incrementReviveCount } from "./agent-state.js";
import type { DeliveryTarget } from "./delivery.js";
import { markDelivered } from "./delivery-state.js";
import { messagePrompt } from "./message-prompt.js";
import { guardRunAction } from "./run-failure.js";

export interface RunAgentContext {
  db: SwarmDb;
  swarmId: number;
  run: number;
  runnerPid: number;
  swarmName: string;
  clock: Clock;
  watchdog: WatchdogConfig | undefined;
  modelHasKnownPricing?(model: ModelSelection | null): boolean;
  /** DeliveryLoop.collect: open messages for a launch prompt. */
  collect(name: string, includeDeliveredUnread: boolean): { text: string; messageIds: number[] };
  isEnding(): boolean;
  canContinue?(): boolean;
  onStatus(name: string, status: ParticipantStatus): void;
  onReady?(name: string): void;
  onRealMessage(name: string): void;
  onError(error: unknown): void;
  onCrash(agent: RunAgent, crash: AgentCrash): void;
}

export interface ReplacementHandoff {
  file: string;
  text: string;
}

export class RunAgent implements DeliveryTarget {
  readonly name: string;
  readonly #spec: AgentLaunchSpec;
  readonly #ctx: RunAgentContext;
  readonly #supervisor: AgentSupervisor;
  #handoff: ReplacementHandoff | undefined;
  #launching = false;
  #revivesThisRun = 0;
  #reviveTimer: TimerHandle | null = null;

  constructor(spec: AgentLaunchSpec, ctx: RunAgentContext, handoff?: ReplacementHandoff) {
    this.name = spec.name;
    this.#handoff = handoff;
    this.#spec = spec;
    this.#ctx = ctx;
    const hooks = createAgentHooks({
      db: ctx.db,
      swarmId: ctx.swarmId,
      run: ctx.run,
      runnerPid: ctx.runnerPid,
      modelPricingKnown: ctx.modelHasKnownPricing?.(spec.context.model) ?? false,
      name: spec.name,
      clock: ctx.clock,
      isEnding: ctx.isEnding,
      onError: ctx.onError,
      onCrash: (crash) => ctx.onCrash(this, crash),
    });
    const observed = {
      ...hooks,
      onReady: () => ctx.onReady?.(this.name),
      onStatus: (status: ParticipantStatus) => {
        if (status === "idle") this.#handoff = undefined;
        hooks.onStatus(status);
        ctx.onStatus(this.name, status);
      },
    };
    this.#supervisor = new AgentSupervisor({
      name: spec.name,
      hooks: observed,
      clock: ctx.clock,
      watchdog: ctx.watchdog,
    });
  }

  /** A launch prompt counts as `starting` until pi accepts it, so the delivery loop can't send its messages twice. */
  get status(): ParticipantStatus {
    return this.#launching ? "starting" : this.#supervisor.status;
  }

  /** Effective shared launch configuration, excluding worker/session identity and credentials. */
  get launchKey(): string {
    return JSON.stringify([this.#spec.cwd, this.#spec.context, this.#spec.maxRpcFrameBytes]);
  }

  get revivesThisRun(): number {
    return this.#revivesThisRun;
  }

  deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
    if (prompt.messageIds.length) this.#ctx.onRealMessage(this.name);
    return this.#ownedOutcome(this.#supervisor.deliver(this.#fenced(prompt)));
  }

  recoverUnread(prompt: PromptPayload): Promise<DeliveryOutcome> {
    if (prompt.messageIds.length) this.#ctx.onRealMessage(this.name);
    return this.#ownedOutcome(this.#supervisor.recoverUnread(this.#fenced(prompt)));
  }

  /** pi reads the file at startup; a missing path would become literal prompt text. */
  writeSystemPrompt(): void {
    fs.mkdirSync(path.dirname(this.#spec.systemPromptFile), { recursive: true });
    fs.writeFileSync(
      this.#spec.systemPromptFile,
      this.name === WATCHER_NAME
        ? buildWatcherPrompt(this.#ctx.swarmName)
        : buildSystemPrompt({
            agentName: this.name,
            swarmName: this.#ctx.swarmName,
            briefPath:
              readProject(this.#ctx.db, this.#ctx.swarmId).briefPath ?? "Brief path missing; call swarm_project",
          }),
    );
  }

  /** Kickoff for a fresh session, the resume prompt when the session already has history. */
  launchFirst(): Promise<void> {
    if (this.#handoff) {
      const { file, text } = this.#handoff;
      return this.#launch([], () =>
        buildKickoffPrompt({
          messages: `Fresh replacement handoff (${file}):\n${text}\nVerify the referenced artifacts before repeating work. Do not replay uncertain side effects.`,
        }),
      );
    }
    const messages = this.#ctx.collect(this.name, true);
    if (this.name === WATCHER_NAME) return this.#launch(messages.messageIds, (text) => text || null);
    const resumed = hasSessionFile(this.#spec.sessionFile);
    return this.#launch(messages.messageIds, (text) =>
      resumed ? buildResumePrompt({ messages: text }) : buildKickoffPrompt({ messages: text }),
    );
  }

  scheduleRevive(delayMs: number): void {
    if (this.#supervisor.status === "stopped") return;
    this.#revivesThisRun++;
    this.#reviveTimer = this.#ctx.clock.after(delayMs, () => {
      this.#reviveTimer = null;
      if (!this.#ctx.isEnding() && this.#ctx.canContinue?.() !== false)
        guardRunAction(() => this.#revive(), this.#ctx.onError);
    });
  }

  quiesce(): Promise<void> {
    this.#reviveTimer?.cancel();
    this.#reviveTimer = null;
    return this.#supervisor.quiesce();
  }

  stop(): Promise<void> {
    this.#reviveTimer?.cancel();
    this.#reviveTimer = null;
    return this.#supervisor.stop();
  }

  #revive(): Promise<void> {
    const { db, swarmId } = this.#ctx;
    // Published by the `starting` status update the launch emits right after.
    incrementReviveCount(db, swarmId, this.name);
    if (this.#handoff) return this.launchFirst();
    const messages = this.#ctx.collect(this.name, true);
    return this.#launch(messages.messageIds, (text) => buildRevivePrompt({ messages: text }));
  }

  async #ownedOutcome(delivery: Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
    const outcome = await delivery;
    if (outcome.accepted && this.#ctx.canContinue?.() === false) {
      return {
        accepted: false,
        error: "The run stopped or lost ownership before delivery confirmation; pending content is preserved.",
      };
    }
    return outcome;
  }

  #fenced(prompt: PromptPayload): PromptPayload {
    return {
      ...prompt,
      beforeSend: () => {
        try {
          if (this.#ctx.canContinue?.() === false) return null;
          return prompt.beforeSend ? prompt.beforeSend() : prompt;
        } catch (error) {
          this.#ctx.onError(error);
          return null;
        }
      },
    };
  }

  async #launch(messageIds: number[], render: (messages: string) => string | null): Promise<void> {
    if (this.#ctx.canContinue?.() === false) return;
    if (messageIds.length) this.#ctx.onRealMessage(this.name);
    this.#launching = true;
    const prompt = messagePrompt(this.#ctx.db, this.#ctx.swarmId, this.name, messageIds, render, this.#ctx.onError);
    const outcome = await this.#ownedOutcome(
      this.#supervisor.launch(this.#spec, prompt ? this.#fenced(prompt) : null),
    ).finally(() => (this.#launching = false));
    const { db, swarmId, clock } = this.#ctx;
    if (outcome.accepted && !this.#ctx.isEnding()) markDelivered(db, swarmId, this.name, messageIds, clock.now());
  }
}

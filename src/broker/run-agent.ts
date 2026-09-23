// One agent within one run: its supervisor, launch prompts and revive state. The run decides the policy.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ParticipantStatus } from "../api-types.js";
import { hasSessionFile, type AgentLaunchSpec } from "../agents/launch.js";
import { buildKickoffPrompt, buildResumePrompt, buildRevivePrompt, buildSystemPrompt } from "../agents/prompt.js";
import { AgentSupervisor, type AgentCrash, type DeliveryOutcome, type PromptPayload } from "../agents/supervisor.js";
import type { WatchdogConfig } from "../agents/watchdog.js";
import type { Clock, TimerHandle } from "../clock.js";
import type { SwarmDb } from "../store/db.js";
import { listPosts } from "../store/wall-queries.js";
import { createAgentHooks } from "./agent-hooks.js";
import { incrementReviveCount } from "./agent-state.js";
import type { DeliveryTarget } from "./delivery.js";
import { markDelivered } from "./delivery-state.js";
import type { AgentLiveness } from "./lifecycle.js";

export interface RunAgentContext {
  db: SwarmDb;
  swarmId: number;
  swarmName: string;
  taskPrompt: string;
  clock: Clock;
  watchdog: WatchdogConfig | undefined;
  /** DeliveryLoop.collect: open messages for a launch prompt. */
  collect(name: string, includeDeliveredUnread: boolean): { text: string; messageIds: number[] };
  isEnding(): boolean;
  onWorking(): void;
  onCrash(agent: RunAgent, crash: AgentCrash): void;
}

export class RunAgent implements DeliveryTarget {
  readonly name: string;
  readonly #spec: AgentLaunchSpec;
  readonly #ctx: RunAgentContext;
  readonly #supervisor: AgentSupervisor;
  #launching = false;
  #revivesThisRun = 0;
  #reviveTimer: TimerHandle | null = null;
  #exhausted = false;

  constructor(spec: AgentLaunchSpec, ctx: RunAgentContext) {
    this.name = spec.name;
    this.#spec = spec;
    this.#ctx = ctx;
    const hooks = createAgentHooks({
      db: ctx.db,
      swarmId: ctx.swarmId,
      name: spec.name,
      clock: ctx.clock,
      isEnding: ctx.isEnding,
      onCrash: (crash) => ctx.onCrash(this, crash),
    });
    const observed = {
      ...hooks,
      onStatus: (status: ParticipantStatus) => {
        hooks.onStatus(status);
        if (status === "working") ctx.onWorking();
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

  get revivesThisRun(): number {
    return this.#revivesThisRun;
  }

  get exhausted(): boolean {
    return this.#exhausted;
  }

  liveness(): AgentLiveness {
    return { status: this.status, reviveScheduled: this.#reviveTimer !== null, revivesExhausted: this.#exhausted };
  }

  deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
    return this.#supervisor.deliver(prompt);
  }

  /** pi reads the file at startup; a missing path would become literal prompt text. */
  writeSystemPrompt(): void {
    fs.mkdirSync(path.dirname(this.#spec.systemPromptFile), { recursive: true });
    fs.writeFileSync(
      this.#spec.systemPromptFile,
      buildSystemPrompt({ agentName: this.name, swarmName: this.#ctx.swarmName }),
    );
  }

  /** Kickoff for a fresh session, the resume prompt when the session already has history. */
  launchFirst(): Promise<void> {
    const { db, swarmId, taskPrompt } = this.#ctx;
    const messages = this.#ctx.collect(this.name, false);
    const text = hasSessionFile(this.#spec.sessionFile)
      ? buildResumePrompt({ messages: messages.text })
      : buildKickoffPrompt({
          taskPrompt,
          wallIsEmpty: listPosts(db, swarmId, { count: 1, offset: 0 }).total === 0,
          messages: messages.text,
        });
    return this.#launch(text, messages.messageIds);
  }

  scheduleRevive(delayMs: number): void {
    this.#revivesThisRun++;
    this.#reviveTimer = this.#ctx.clock.after(delayMs, () => {
      this.#reviveTimer = null;
      if (!this.#ctx.isEnding()) void this.#revive();
    });
  }

  /** Crashed for good this run; completion no longer waits for it or its messages. */
  giveUp(): void {
    this.#exhausted = true;
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
    const messages = this.#ctx.collect(this.name, true);
    return this.#launch(buildRevivePrompt({ messages: messages.text }), messages.messageIds);
  }

  async #launch(text: string, messageIds: number[]): Promise<void> {
    this.#launching = true;
    const outcome = await this.#supervisor
      .launch(this.#spec, { text, messageIds })
      .finally(() => (this.#launching = false));
    const { db, swarmId, clock } = this.#ctx;
    if (outcome.accepted && !this.#ctx.isEnding()) markDelivered(db, swarmId, this.name, messageIds, clock.now());
  }
}

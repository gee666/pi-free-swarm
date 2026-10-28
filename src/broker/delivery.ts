// Runner side of plan §7.2: moves pending messages into running agents. Written messages from any process
// are found by the poll; writes in this process wake the loop at once through notify.ts.
import type { ParticipantStatus } from "../api-types.js";
import type { DeliveryOutcome, PromptPayload } from "../agents/supervisor.js";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { DELIVERY_POLL_MS } from "../constants.js";
import { formatNotificationMessages } from "./notification-format.js";
import type { SwarmDb } from "../store/db.js";
import { getMessages, listOpenAgentRecipients } from "../store/message-queries.js";
import { markDelivered } from "./delivery-state.js";
import { messagePrompt } from "./message-prompt.js";
import { onLocalMessage } from "./notify.js";
import { guardRunAction } from "./run-failure.js";

export interface DeliveryTarget {
  readonly status: ParticipantStatus;
  deliver(prompt: PromptPayload): Promise<DeliveryOutcome>;
  recoverUnread?(prompt: PromptPayload): Promise<DeliveryOutcome>;
}

export interface DeliveryLoopOptions {
  db: SwarmDb;
  swarmId: number;
  /** By canonical agent name. */
  agents: ReadonlyMap<string, DeliveryTarget>;
  clock?: Clock;
  pollMs?: number;
  onError?(error: unknown): void;
}

/** Only these accept a prompt; pending and crashed agents get their messages in the next launch prompt. */
const RECEIVING: ReadonlySet<ParticipantStatus> = new Set(["working", "idle"]);

export class DeliveryLoop {
  readonly #db: SwarmDb;
  readonly #swarmId: number;
  readonly #agents: ReadonlyMap<string, DeliveryTarget>;
  readonly #clock: Clock;
  readonly #pollMs: number;
  readonly #onError: (error: unknown) => void;
  /** One prompt per agent at a time, so a slow response never doubles a delivery. */
  readonly #inFlight = new Set<string>();
  #timers: TimerHandle[] = [];
  #wake: TimerHandle | null = null;
  #unsubscribe: (() => void) | null = null;
  #running = false;

  constructor(options: DeliveryLoopOptions) {
    this.#db = options.db;
    this.#swarmId = options.swarmId;
    this.#agents = options.agents;
    this.#clock = options.clock ?? systemClock;
    this.#pollMs = options.pollMs ?? DELIVERY_POLL_MS;
    this.#onError = (error) => {
      this.stop();
      options.onError?.(error);
    };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timers.push(this.#clock.every(this.#pollMs, () => guardRunAction(() => this.#pass(), this.#onError)));
    this.#unsubscribe = onLocalMessage((swarmId) => {
      if (swarmId === this.#swarmId) this.#soon();
    });
    this.#soon();
  }

  stop(): void {
    this.#running = false;
    for (const timer of this.#timers) timer.cancel();
    this.#timers = [];
    this.#wake?.cancel();
    this.#wake = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Messages for a launch prompt. A revive also re-sends delivered-not-read ones: pi's queue died. */
  collect(name: string, includeDeliveredUnread: boolean): { text: string; messageIds: number[] } {
    const messageIds = listOpenAgentRecipients(this.#db, this.#swarmId)
      .filter((open) => open.name === name && (open.status === "pending" || includeDeliveredUnread))
      .map((open) => open.messageId);
    return { text: formatNotificationMessages(this.#db, getMessages(this.#db, messageIds), name), messageIds };
  }

  /** Deferred, so a write never runs a delivery pass inside its caller. */
  #soon(): void {
    if (!this.#running || this.#wake) return;
    this.#wake = this.#clock.after(0, () => {
      this.#wake = null;
      guardRunAction(() => this.#pass(), this.#onError);
    });
  }

  #pass(): void {
    if (!this.#running) return;
    const open = listOpenAgentRecipients(this.#db, this.#swarmId);
    for (const [name, target] of this.#agents) {
      if (!RECEIVING.has(target.status) || this.#inFlight.has(name)) continue;
      const recipients = open.filter((recipient) => recipient.name === name);
      const recover =
        target.status === "idle" &&
        !!target.recoverUnread &&
        recipients.some((recipient) => recipient.status === "delivered");
      const messageIds = recipients
        .filter((recipient) => recover || recipient.status === "pending")
        .map((recipient) => recipient.messageId);
      if (messageIds.length) guardRunAction(() => this.#deliver(name, target, messageIds, recover), this.#onError);
    }
  }

  async #deliver(name: string, target: DeliveryTarget, messageIds: number[], recover: boolean): Promise<void> {
    this.#inFlight.add(name);
    const prompt = messagePrompt(this.#db, this.#swarmId, name, messageIds, undefined, this.#onError);
    if (prompt === null) {
      this.#inFlight.delete(name);
      return;
    }
    const outcome = await (
      recover && target.recoverUnread ? target.recoverUnread(prompt) : target.deliver(prompt)
    ).finally(() => this.#inFlight.delete(name));
    if (!this.#running || !outcome.accepted) return;
    markDelivered(this.#db, this.#swarmId, name, messageIds, this.#clock.now());
    // More may have arrived while this prompt was on its way. A rejection waits for the poll instead.
    this.#soon();
  }
}

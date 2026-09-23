// Runner side of plan §7.2: moves pending messages into running agents. Written messages from any process
// are found by the poll; writes in this process wake the loop at once through notify.ts.
import type { MessageView, ParticipantStatus } from "../api-types.js";
import type { DeliveryOutcome, PromptPayload } from "../agents/supervisor.js";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { DELIVERY_POLL_MS, USER_NAME } from "../constants.js";
import { formatDeliveredMessages } from "../message-format.js";
import type { SwarmDb } from "../store/db.js";
import { getMessages, listInboxAfter, listOpenAgentRecipients } from "../store/message-queries.js";
import { markDelivered } from "./delivery-state.js";
import { onLocalMessage } from "./notify.js";

export interface DeliveryTarget {
  readonly status: ParticipantStatus;
  deliver(prompt: PromptPayload): Promise<DeliveryOutcome>;
}

export interface DeliveryLoopOptions {
  db: SwarmDb;
  swarmId: number;
  /** By canonical agent name. */
  agents: ReadonlyMap<string, DeliveryTarget>;
  clock?: Clock;
  pollMs?: number;
  /** Each new message in the User's inbox, once. */
  onUserMessage?(message: MessageView): void;
}

/** Only these accept a prompt; pending and crashed agents get their messages in the next launch prompt. */
const RECEIVING: ReadonlySet<ParticipantStatus> = new Set(["working", "idle"]);

export class DeliveryLoop {
  readonly #db: SwarmDb;
  readonly #swarmId: number;
  readonly #agents: ReadonlyMap<string, DeliveryTarget>;
  readonly #clock: Clock;
  readonly #pollMs: number;
  readonly #onUserMessage: ((message: MessageView) => void) | undefined;
  /** One prompt per agent at a time, so a slow response never doubles a delivery. */
  readonly #inFlight = new Set<string>();
  #timers: TimerHandle[] = [];
  #wake: TimerHandle | null = null;
  #unsubscribe: (() => void) | null = null;
  #userCursor = 0;
  #running = false;

  constructor(options: DeliveryLoopOptions) {
    this.#db = options.db;
    this.#swarmId = options.swarmId;
    this.#agents = options.agents;
    this.#clock = options.clock ?? systemClock;
    this.#pollMs = options.pollMs ?? DELIVERY_POLL_MS;
    this.#onUserMessage = options.onUserMessage;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    // Only messages that arrive during this run are news for the terminal.
    this.#userCursor = listInboxAfter(this.#db, this.#swarmId, USER_NAME, 0).at(-1)?.id ?? 0;
    this.#timers.push(this.#clock.every(this.#pollMs, () => this.#pass()));
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
    return { text: formatDeliveredMessages(getMessages(this.#db, messageIds), name), messageIds };
  }

  /** Deferred, so a write never runs a delivery pass inside its caller. */
  #soon(): void {
    if (!this.#running || this.#wake) return;
    this.#wake = this.#clock.after(0, () => {
      this.#wake = null;
      this.#pass();
    });
  }

  #pass(): void {
    if (!this.#running) return;
    const pending = new Map<string, number[]>();
    for (const open of listOpenAgentRecipients(this.#db, this.#swarmId)) {
      if (open.status !== "pending") continue;
      pending.set(open.name, [...(pending.get(open.name) ?? []), open.messageId]);
    }
    for (const [name, messageIds] of pending) {
      const target = this.#agents.get(name);
      if (target && RECEIVING.has(target.status) && !this.#inFlight.has(name)) {
        void this.#deliver(name, target, messageIds);
      }
    }
    this.#announceUserMessages();
  }

  async #deliver(name: string, target: DeliveryTarget, messageIds: number[]): Promise<void> {
    this.#inFlight.add(name);
    const text = formatDeliveredMessages(getMessages(this.#db, messageIds), name);
    const outcome = await target.deliver({ text, messageIds }).finally(() => this.#inFlight.delete(name));
    if (!this.#running || !outcome.accepted) return;
    markDelivered(this.#db, this.#swarmId, name, messageIds, this.#clock.now());
    // More may have arrived while this prompt was on its way. A rejection waits for the poll instead.
    this.#soon();
  }

  #announceUserMessages(): void {
    const onUserMessage = this.#onUserMessage;
    if (!onUserMessage) return;
    for (const message of listInboxAfter(this.#db, this.#swarmId, USER_NAME, this.#userCursor)) {
      this.#userCursor = message.id;
      onUserMessage(message);
    }
  }
}

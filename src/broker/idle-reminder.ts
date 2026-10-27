import type { ParticipantStatus } from "../api-types.js";
import type { PromptPayload } from "../agents/supervisor.js";
import type { Clock, TimerHandle } from "../clock.js";
import { IDLE_REMINDER_HEADER, WATCHER_NAME } from "../constants.js";
import type { SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import { listOpenAgentRecipients } from "../store/message-queries.js";
import { evaluateCompletion } from "./completion.js";
import { workReminder } from "./work-reminder.js";
import type { DeliveryTarget } from "./delivery.js";
import { guardRunAction } from "./run-failure.js";
import { reminderSnoozedUntil } from "./reminder-snooze.js";

interface ReminderState {
  timer: TimerHandle | null;
  scheduledFor: number;
  inFlight: boolean;
}

interface IdleReminderOptions {
  db: SwarmDb;
  swarmId: number;
  clock: Clock;
  settings: Pick<SwarmSettings, "idleReminderDelay">;
  agents: ReadonlyMap<string, DeliveryTarget>;
  onError(error: unknown): void;
}

export class IdleReminders {
  readonly #options: IdleReminderOptions;
  readonly #states = new Map<string, ReminderState>();
  #stopped = false;

  constructor(options: IdleReminderOptions) {
    this.#options = options;
    this.#syncAgents();
  }

  statusChanged(name: string, status: ParticipantStatus): void {
    if (status !== "idle") this.#cancel(name);
  }

  realMessage(name: string): void {
    this.#cancel(name);
  }

  /** Reconcile before checking completion; true while a timer or prompt is outstanding. */
  update(): boolean {
    if (this.#stopped) return false;
    this.#syncAgents();
    const { agents, clock, settings } = this.#options;
    const decided = this.#decided();
    const open = this.#openRecipients();
    for (const [name, state] of this.#states) {
      if (decided || open.has(name) || agents.get(name)?.status !== "idle") this.#cancel(name);
      else {
        const until = reminderSnoozedUntil(this.#options.db, this.#options.swarmId, name);
        const now = clock.now();
        if (until > now && state.timer && state.scheduledFor !== until) this.#cancel(name);
        if (!state.timer && !state.inFlight) {
          const delay = until > now ? until - now : settings.idleReminderDelay;
          state.scheduledFor = now + delay;
          state.timer = clock.after(delay, () => {
            state.timer = null;
            guardRunAction(() => this.#send(name, state), this.#options.onError);
          });
        }
      }
    }
    return [...this.#states.values()].some((state) => state.timer !== null || state.inFlight);
  }

  stop(): void {
    this.#stopped = true;
    for (const name of this.#states.keys()) this.#cancel(name);
  }

  #syncAgents(): void {
    for (const name of this.#states.keys()) {
      if (this.#options.agents.has(name)) continue;
      this.#cancel(name);
      this.#states.delete(name);
    }
    for (const name of this.#options.agents.keys()) {
      if (name === WATCHER_NAME || this.#states.has(name)) continue;
      this.#states.set(name, { timer: null, scheduledFor: 0, inFlight: false });
    }
  }

  #cancel(name: string): void {
    const state = this.#states.get(name);
    state?.timer?.cancel();
    if (state) state.timer = null;
  }

  #decided(): boolean {
    const { db, swarmId } = this.#options;
    const completion = evaluateCompletion(db, swarmId);
    return completion.done || completion.awaitingUser;
  }

  #openRecipients(): Set<string> {
    const { db, swarmId } = this.#options;
    return new Set(listOpenAgentRecipients(db, swarmId).map((recipient) => recipient.name));
  }

  async #send(name: string, state: ReminderState): Promise<void> {
    const { db, swarmId, agents, clock } = this.#options;
    const agent = agents.get(name);
    if (this.#stopped || state.inFlight || !agent || agent.status !== "idle" || this.#openRecipients().has(name))
      return;
    if (reminderSnoozedUntil(db, swarmId, name) > clock.now()) return;
    if (this.#decided()) return;
    const digest = workReminder(db, swarmId, name, clock.now());
    state.inFlight = true;
    try {
      const prompt: PromptPayload = {
        text: [IDLE_REMINDER_HEADER, digest].join("\n\n"),
        messageIds: [],
      };
      await agent.deliver({
        ...prompt,
        beforeSend: () =>
          this.#stopped ||
          this.#decided() ||
          agents.get(name) !== agent ||
          reminderSnoozedUntil(db, swarmId, name) > clock.now()
            ? null
            : prompt,
      });
    } finally {
      state.inFlight = false;
    }
  }
}

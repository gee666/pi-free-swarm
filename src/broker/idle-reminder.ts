import type { ParticipantStatus } from "../api-types.js";
import type { Clock, TimerHandle } from "../clock.js";
import { IDLE_REMINDER_HEADER, WATCHER_NAME } from "../constants.js";
import type { SwarmSettings } from "../settings.js";
import { TEXT_MAX } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { listOpenAgentRecipients } from "../store/message-queries.js";
import { listPosts } from "../store/wall-queries.js";
import { formatPostList } from "../wall-format.js";
import { inspectAcceptance } from "./acceptance.js";
import type { DeliveryTarget } from "./delivery.js";
import { guardRunAction } from "./run-failure.js";
import { wallPreviewChars } from "./wall-delta.js";

interface ReminderState {
  timer: TimerHandle | null;
  inFlight: boolean;
}

interface IdleReminderOptions {
  db: SwarmDb;
  swarmId: number;
  clock: Clock;
  settings: Pick<SwarmSettings, "idleReminderDelay" | "idleReminderDigestSize">;
  agents: ReadonlyMap<string, DeliveryTarget>;
  onError(error: unknown): void;
}

export class IdleReminders {
  readonly #options: IdleReminderOptions;
  readonly #states = new Map<string, ReminderState>();
  #stopped = false;

  constructor(options: IdleReminderOptions) {
    this.#options = options;
    for (const name of options.agents.keys()) {
      if (name === WATCHER_NAME) continue;
      this.#states.set(name, {
        timer: null,
        inFlight: false,
      });
    }
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
    const { agents, clock, settings } = this.#options;
    const decided = this.#decided();
    const open = this.#openRecipients();
    for (const [name, state] of this.#states) {
      if (decided || open.has(name) || agents.get(name)?.status !== "idle") this.#cancel(name);
      else if (!state.timer && !state.inFlight) {
        state.timer = clock.after(settings.idleReminderDelay, () => {
          state.timer = null;
          guardRunAction(() => this.#send(name, state), this.#options.onError);
        });
      }
    }
    return [...this.#states.values()].some((state) => state.timer !== null || state.inFlight);
  }

  stop(): void {
    this.#stopped = true;
    for (const name of this.#states.keys()) this.#cancel(name);
  }

  #cancel(name: string): void {
    const state = this.#states.get(name);
    state?.timer?.cancel();
    if (state) state.timer = null;
  }

  #decided(): boolean {
    const { db, swarmId } = this.#options;
    const verdict = inspectAcceptance(db, swarmId).verdict;
    return verdict === "accepted" || verdict === "blocked";
  }

  #openRecipients(): Set<string> {
    const { db, swarmId } = this.#options;
    return new Set(listOpenAgentRecipients(db, swarmId).map((recipient) => recipient.name));
  }

  async #send(name: string, state: ReminderState): Promise<void> {
    const { db, swarmId, agents, settings, clock } = this.#options;
    const agent = agents.get(name);
    if (this.#stopped || state.inFlight || !agent || agent.status !== "idle" || this.#openRecipients().has(name))
      return;
    const acceptance = inspectAcceptance(db, swarmId);
    if (acceptance.verdict === "accepted" || acceptance.verdict === "blocked") return;
    const page = listPosts(db, swarmId, { count: settings.idleReminderDigestSize, offset: 0 });
    const digest = formatPostList(page, [], 0, clock.now(), Math.min(TEXT_MAX, wallPreviewChars(db)));
    state.inFlight = true;
    try {
      const { counts, threshold, totalAgents } = acceptance;
      const tally = `Votes: ${counts.accepted} accepted, ${counts.incomplete} incomplete, ${counts.blocked} blocked. Quorum: ${threshold}/${totalAgents} for the same accepted or blocked verdict.`;
      await agent.deliver({ text: `${IDLE_REMINDER_HEADER}\n\n${tally}\n\n${digest}`, messageIds: [] });
    } finally {
      state.inFlight = false;
    }
  }
}

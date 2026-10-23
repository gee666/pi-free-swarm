import type { AcceptanceRecord } from "../store/acceptance-types.js";
import type { IdleReminders } from "./idle-reminder.js";
import { prepareRunCompletion } from "./run-acceptance.js";
import type { RunControls } from "./run-controls.js";
import type { RunEnvironment } from "./run-types.js";

/** Coalesce only awaited bookkeeping, never budget, ownership or the terminal quorum checks. */
export class RunCompletion {
  #pending = false;
  constructor(
    readonly options: {
      env: RunEnvironment;
      swarmId: number;
      run: number;
      controls: RunControls;
      reminders: IdleReminders;
      canRun(): boolean;
      ending(): boolean;
      closed(acceptance: AcceptanceRecord): void;
      lost(): void;
    },
  ) {}

  async check(): Promise<void> {
    // Draining blocks autonomous work, not owned controls or a real terminal quorum.
    this.options.canRun();
    if (this.options.ending() || this.#decide() || this.#pending) return;
    this.#pending = true;
    try {
      await this.options.controls.update();
      const canWorkAfterControls = this.options.canRun();
      if (this.options.ending() || this.#decide()) return;
      if (canWorkAfterControls) this.options.reminders.update();
    } finally {
      this.#pending = false;
    }
  }

  #decide(): boolean {
    const { env, swarmId, run } = this.options;
    const decision = prepareRunCompletion(env.db, { swarmId, run, runnerPid: env.runnerPid, now: env.clock.now() });
    if (decision.kind === "pending") return false;
    if (decision.kind === "closed") this.options.closed(decision.acceptance);
    else this.options.lost();
    return true;
  }
}

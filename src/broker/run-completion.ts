import type { IdleReminders } from "./idle-reminder.js";
import { prepareWorkRunCompletion } from "./work-run-completion.js";
import type { RunControls } from "./run-controls.js";
import type { RunEnvironment } from "./run-types.js";

/** Coalesce bookkeeping without delaying ownership and completion checks. */
export class RunCompletion {
  #pending = false;
  constructor(
    readonly options: {
      env: RunEnvironment;
      swarmId: number;
      run: number;
      controls: Pick<RunControls, "update">;
      reminders: Pick<IdleReminders, "update">;
      canRun(): boolean;
      ending(): boolean;
      closed(): void;
      lost(): void;
    },
  ) {}

  async check(): Promise<void> {
    const canWork = this.options.canRun();
    if (this.options.ending() || (canWork && this.#decide()) || this.#pending) return;
    this.#pending = true;
    try {
      await this.options.controls.update();
      const canWorkAfterControls = this.options.canRun();
      if (!canWorkAfterControls || this.options.ending() || this.#decide()) return;
      this.options.reminders.update();
    } finally {
      this.#pending = false;
    }
  }

  #decide(): boolean {
    const { env, swarmId, run } = this.options;
    const decision = prepareWorkRunCompletion(env.db, { swarmId, run, runnerPid: env.runnerPid, now: env.clock.now() });
    if (decision.kind === "pending") return false;
    if (decision.kind === "closed") this.options.closed();
    else this.options.lost();
    return true;
  }
}

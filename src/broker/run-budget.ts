import { readBudget, recordBudgetStop } from "./budget.js";
import type { RunEnvironment } from "./run-types.js";

/** A budget stops execution, never the task's electorate or verdict. */
export class RunBudget {
  stopped = false;
  constructor(
    readonly env: RunEnvironment,
    readonly swarmId: number,
    readonly run: number,
    readonly drain: () => void,
    readonly active: () => boolean,
    readonly end: () => void,
  ) {}

  check(): boolean {
    const { db, clock, settings } = this.env;
    // Runtime edits cannot turn an unlimited dimension into an enforced limit.
    if (!this.stopped && settings.budgetMoneyUsd === undefined && settings.budgetTimeSeconds === undefined)
      return false;
    const budget = readBudget(db, this.swarmId, settings, clock.now());
    if (budget.moneyUsd !== null && budget.hasAccountingGaps) {
      throw new Error(
        "Money budget accounting is incomplete. Execution cannot continue with unknown costs; inspect the evidence before resuming without a money limit.",
      );
    }
    if (!this.stopped && budget.exhausted) {
      this.stopped = true;
      recordBudgetStop(db, this.swarmId, this.run, budget.exhausted, clock.now());
      this.env.notifyUser(`Swarm #${this.swarmId} budget exhausted (${budget.exhausted}). ${budget.accounting}`);
      this.drain();
    }
    if (this.stopped && (!budget.gracefulShutdown || !this.active())) this.end();
    return this.stopped;
  }
}

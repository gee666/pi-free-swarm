export interface BudgetCeilings {
  moneyUsd: number | null;
  timeSeconds: number | null;
}

export interface BudgetRaises {
  moneyUsd?: number;
  timeSeconds?: number;
}

/** Explicit per-swarm ceilings survive resume, including reductions and formerly unlimited budgets. */
export function mergeBudgetRaises(configured: BudgetCeilings, raises: BudgetRaises): BudgetCeilings {
  return {
    moneyUsd: raises.moneyUsd ?? configured.moneyUsd,
    timeSeconds: raises.timeSeconds ?? configured.timeSeconds,
  };
}

export interface BudgetStatus {
  moneyUsd: number | null;
  timeSeconds: number | null;
  costUsd: number;
  activeTimeMs: number;
  gracefulShutdown: boolean;
  exhausted: "money" | "time" | null;
  stopReason: "budget-exhausted" | null;
  moneyOvershootUsd: number;
  timeOvershootSeconds: number;
  hasAccountingGaps?: boolean;
  hasInterruptedRuns?: boolean;
  accounting: string;
}

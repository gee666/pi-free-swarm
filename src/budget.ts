export interface BudgetCeilings {
  moneyUsd: number | null;
  timeSeconds: number | null;
}

export interface BudgetRaises {
  moneyUsd?: number;
  timeSeconds?: number;
}

/** Keep per-swarm UI raises when a resume still supplies older project defaults. */
export function mergeBudgetRaises(configured: BudgetCeilings, raises: BudgetRaises): BudgetCeilings {
  return {
    moneyUsd:
      configured.moneyUsd === null ? null : Math.max(configured.moneyUsd, raises.moneyUsd ?? configured.moneyUsd),
    timeSeconds:
      configured.timeSeconds === null
        ? null
        : Math.max(configured.timeSeconds, raises.timeSeconds ?? configured.timeSeconds),
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
  accounting: string;
}

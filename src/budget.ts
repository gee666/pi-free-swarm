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
  accounting: string;
}

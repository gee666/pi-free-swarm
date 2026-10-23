import { createContext, useContext, type ReactNode } from "react";
import type { BudgetStatus } from "../../../../src/budget";
import type { RunConfiguration } from "../../../../src/run-configuration";
import { useSwarmDetail } from "../../api/SwarmView";
import { BudgetDetails } from "../../components/BudgetSummary";
import styles from "./Config.module.css";

const AccountingContext = createContext<BudgetStatus | null | undefined>(undefined);

export function LiveRuntimeAccounting({
  swarmId,
  initial,
  children,
}: {
  swarmId: string;
  initial: BudgetStatus | null | undefined;
  children: ReactNode;
}) {
  const detail = useSwarmDetail(swarmId);
  return (
    <AccountingContext.Provider value={detail.data?.swarm.budget ?? initial}>{children}</AccountingContext.Provider>
  );
}

export function RuntimeBudgetDetails({ fallback }: { fallback: BudgetStatus | null }) {
  const accounting = useContext(AccountingContext);
  return <BudgetDetails budget={accounting ?? fallback} />;
}

export function RuntimeBudgetMetrics({
  budget,
  fallback,
}: {
  budget: RunConfiguration["budget"] | null;
  fallback?: BudgetStatus | null;
}) {
  const accounting = useContext(AccountingContext) ?? fallback;
  return (
    <div className={styles.metrics}>
      <div>
        <span>Money ceiling</span>
        <strong>{!budget ? "Unavailable" : budget.moneyUsd === null ? "Unlimited" : `$${budget.moneyUsd}`}</strong>
        <small>{accounting ? `$${accounting.costUsd.toFixed(4)} spent` : "Usage unavailable"}</small>
      </div>
      <div>
        <span>Active-time ceiling</span>
        <strong>
          {!budget ? "Unavailable" : budget.timeSeconds === null ? "Unlimited" : `${budget.timeSeconds}s`}
        </strong>
        <small>{accounting ? `${(accounting.activeTimeMs / 1000).toFixed(1)}s used` : "Usage unavailable"}</small>
      </div>
    </div>
  );
}

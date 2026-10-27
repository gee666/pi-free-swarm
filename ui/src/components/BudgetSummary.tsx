import { useRef, useState } from "react";
import type { BudgetStatus } from "../../../src/budget";
import { Popover } from "./Popover";
import styles from "./RunSummary.module.css";

export function BudgetDetails({ budget }: { budget?: BudgetStatus | null }) {
  if (!budget) return <p>No budget accounting was recorded for this run.</p>;
  return (
    <>
      <h3>Cumulative budget accounting</h3>
      <p>
        Reported spend: ${budget.costUsd.toFixed(4)} USD /{" "}
        {budget.moneyUsd === null ? "unlimited" : `$${budget.moneyUsd} USD`}
      </p>
      <p>
        Active execution: {(budget.activeTimeMs / 1000).toFixed(1)} seconds /{" "}
        {budget.timeSeconds === null ? "unlimited" : `${budget.timeSeconds} seconds`}
      </p>
      <p>Stop reason: {budget.stopReason ?? "no budget stop recorded"}</p>
      <p>Exhausted limit: {budget.exhausted ?? "none"}</p>
      <p>
        Overshoot: ${budget.moneyOvershootUsd.toFixed(4)} USD · {budget.timeOvershootSeconds.toFixed(1)} seconds
      </p>
      <p>
        Shutdown policy:{" "}
        {budget.gracefulShutdown ? "finish active pi turn without admitting new work" : "interrupt immediately"}
      </p>
      <p>{budget.accounting}</p>
      <p>
        Any increase is a new cumulative ceiling, not an accounting reset. Resume only after the user approves the
        increase.
      </p>
    </>
  );
}

export function BudgetSummary({ budget }: { budget?: BudgetStatus | null }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!budget) return null;
  return (
    <>
      <button ref={anchor} className={styles.pill} aria-expanded={open} onClick={() => setOpen(!open)}>
        {budget.exhausted ? `Budget exhausted: ${budget.exhausted}` : "Budget accounting"}
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="end" className={styles.summary}>
        <BudgetDetails budget={budget} />
      </Popover>
    </>
  );
}

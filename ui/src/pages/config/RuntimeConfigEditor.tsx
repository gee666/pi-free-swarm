import { useState, type FormEvent } from "react";
import type { BudgetStatus } from "../../../../src/budget";
import type { RunConfiguration, WorkerAssignment } from "../../../../src/run-configuration";
import type { ConfigurationChange } from "../../../../src/runtime-configuration";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { ErrorBanner } from "../../components/States";
import { WorkerModel } from "../../components/WorkerModel";
import { RuntimeBudgetMetrics } from "./RuntimeBudgetMetrics";
import styles from "./Config.module.css";

export type BudgetRaise = Omit<Extract<ConfigurationChange, { type: "raiseBudget" }>, "type">;

interface RuntimeConfigEditorProps {
  workers: readonly { name: string; model?: WorkerAssignment | null }[];
  budget: RunConfiguration["budget"] | null;
  accounting?: BudgetStatus | null;
  disabled?: boolean;
  maxAgents?: number;
  onAdd: (count: number) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  onRaiseBudget: (patch: BudgetRaise) => Promise<void>;
}

export function RuntimeConfigEditor({
  workers,
  budget,
  accounting,
  disabled = false,
  maxAgents,
  onAdd,
  onRemove,
  onRaiseBudget,
}: RuntimeConfigEditorProps) {
  const [count, setCount] = useState("1");
  const [money, setMoney] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const locked = disabled || busy;
  const submit = async (action: () => Promise<void>) => {
    if (locked) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      setNotice("Change requested. The view refreshes as the runtime applies it.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    void submit(async () => {
      const amount = Number(count);
      if (!/^[1-9]\d*$/.test(count) || !Number.isSafeInteger(amount))
        throw new Error("Workers to add must be a positive integer.");
      if (maxAgents !== undefined && workers.length + amount > maxAgents)
        throw new Error(`Requested total exceeds this run's recorded maximum of ${maxAgents}.`);
      await onAdd(amount);
      setCount("1");
    });
  };
  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    void submit(async () => {
      if (!budget) throw new Error("No saved budget policy is available.");
      const patch: BudgetRaise = {};
      for (const [key, input] of [
        ["moneyUsd", money],
        ["timeSeconds", time],
      ] as const) {
        if (!input.trim()) continue;
        const value = Number(input);
        if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a finite positive total ceiling.`);
        patch[key] = value;
      }
      if (Object.keys(patch).length === 0) throw new Error("Enter at least one budget ceiling.");
      await onRaiseBudget(patch);
      setMoney("");
      setTime("");
    });
  };
  return (
    <section className={styles.editor} aria-label="Edit swarm configuration">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>Active workers</h3>
            <p>Manage your swarm's capacity.</p>
          </div>
          <span className={styles.badge}>
            {workers.length} / {maxAgents ?? "—"} workers
          </span>
        </div>
        <ul className={styles.workers}>
          {workers.map((worker) => (
            <li key={worker.name}>
              <span className={styles.workerAvatar} aria-hidden="true">
                {worker.name.slice(0, 1)}
              </span>
              <span className={styles.workerIdentity}>
                <strong>{worker.name}</strong>
                <small>
                  <WorkerModel model={worker.model} />
                </small>
              </span>
              <Button
                size="sm"
                disabled={locked || workers.length <= 1}
                onClick={() => void submit(() => onRemove(worker.name))}
              >
                Remove {worker.name}
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className={styles.addForm}>
          <label className={styles.field}>
            Workers to add
            <TextField label="Workers to add" value={count} onChange={setCount} disabled={locked} />
          </label>
          <Button type="submit" disabled={locked}>
            Add workers
          </Button>
        </form>
        <p className={styles.hint}>
          Removing a worker keeps its votes; tasks it owns must be handed off before their criteria can be agreed.
        </p>
      </div>
      <section className={styles.card} aria-labelledby="budget-editor-title">
        <div className={styles.sectionHeader}>
          <div>
            <h3 id="budget-editor-title">Budget limits</h3>
            <p>Set or adjust total ceilings. Usage is not reset.</p>
          </div>
          <span className={styles.badge}>{budget ? "Cumulative" : "Unavailable"}</span>
        </div>
        <RuntimeBudgetMetrics budget={budget} fallback={accounting} />
        <form onSubmit={saveBudget} className={styles.editForm}>
          <label className={styles.field}>
            Money ceiling, USD
            <TextField
              label="New money ceiling, USD"
              value={money}
              onChange={setMoney}
              placeholder={!budget ? "Unavailable" : budget.moneyUsd === null ? "Unlimited" : String(budget.moneyUsd)}
              disabled={locked || !budget}
            />
          </label>
          <label className={styles.field}>
            Active-time ceiling, seconds
            <TextField
              label="New active-time ceiling, seconds"
              value={time}
              onChange={setTime}
              placeholder={
                !budget ? "Unavailable" : budget.timeSeconds === null ? "Unlimited" : String(budget.timeSeconds)
              }
              disabled={locked || !budget}
            />
          </label>
          <Button type="submit" disabled={locked || !budget}>
            Save budgets
          </Button>
        </form>
        <p className={styles.hint}>
          Leave a field empty to keep its current limit. A limit at or below current usage triggers the run's budget
          stop policy.
        </p>
      </section>
    </section>
  );
}

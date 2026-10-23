import { useState, type FormEvent } from "react";
import type { RunConfiguration, WorkerAssignment } from "../../../../src/run-configuration";
import type { ConfigurationChange } from "../../../../src/runtime-configuration";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { ErrorBanner } from "../../components/States";
import { WorkerModel } from "../../components/WorkerModel";
import styles from "./Config.module.css";

export type BudgetRaise = Omit<Extract<ConfigurationChange, { type: "raiseBudget" }>, "type">;

interface RuntimeConfigEditorProps {
  workers: readonly { name: string; model?: WorkerAssignment | null }[];
  budget: RunConfiguration["budget"] | null;
  disabled?: boolean;
  maxAgents?: number;
  onAdd: (count: number) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  onRaiseBudget: (patch: BudgetRaise) => Promise<void>;
}

export function RuntimeConfigEditor({
  workers,
  budget,
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
  const raise = (event: FormEvent) => {
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
        const current = budget[key];
        if (current === null) throw new Error(`${key} is already unlimited.`);
        if (!Number.isFinite(value) || value <= current)
          throw new Error(`${key} must exceed the current total ceiling of ${current}.`);
        patch[key] = value;
      }
      if (Object.keys(patch).length === 0) throw new Error("Enter at least one higher budget ceiling.");
      await onRaiseBudget(patch);
      setMoney("");
      setTime("");
    });
  };
  return (
    <section className={styles.editor} aria-label="Edit swarm configuration">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && <p role="status">{notice}</p>}
      <h3>Active workers</h3>
      <p>
        {workers.length} active workers · {maxAgents === undefined ? "Maximum not recorded" : `maximum ${maxAgents}`}
      </p>
      <p>
        Removing a worker stops it and removes its vote from the current 70% quorum denominator. Unfinished work may
        need reassignment.
      </p>
      <ul className={styles.workers}>
        {workers.map((worker) => (
          <li key={worker.name}>
            <span>
              {worker.name}
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
      <form onSubmit={add} className={styles.editForm}>
        <TextField label="Workers to add" value={count} onChange={setCount} disabled={locked} />
        <Button type="submit" disabled={locked}>
          Add workers
        </Button>
      </form>
      <h3>Raise cumulative budget ceilings</h3>
      <p>
        These are new total ceilings, not extra allowances. Consumption and saved work are not reset. Empty fields leave
        a ceiling unchanged.
      </p>
      <form onSubmit={raise} className={styles.editForm}>
        <label>
          Money ceiling, USD
          <TextField
            label="New money ceiling, USD"
            value={money}
            onChange={setMoney}
            placeholder={budget?.moneyUsd == null ? "Unlimited" : String(budget.moneyUsd)}
            disabled={locked || budget?.moneyUsd == null}
          />
        </label>
        <label>
          Active-time ceiling, seconds
          <TextField
            label="New active-time ceiling, seconds"
            value={time}
            onChange={setTime}
            placeholder={budget?.timeSeconds == null ? "Unlimited" : String(budget.timeSeconds)}
            disabled={locked || budget?.timeSeconds == null}
          />
        </label>
        <Button type="submit" disabled={locked || !budget || (budget.moneyUsd === null && budget.timeSeconds === null)}>
          Raise budgets
        </Button>
      </form>
    </section>
  );
}

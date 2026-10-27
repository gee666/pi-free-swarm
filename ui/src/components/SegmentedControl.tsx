import type { KeyboardEvent } from "react";
import { cx } from "../lib/cx";
import styles from "./SegmentedControl.module.css";
import { Tooltip } from "./Tooltip";

export interface Segment<T extends string> {
  value: T;
  /** Full label including any count, e.g. "Inbox (3)". */
  label: string;
  disabledReason?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Mailbox". */
  label: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const available = options.filter((option) => !option.disabledReason);
    if (available.length === 0) return;
    const index = available.findIndex((option) => option.value === value);
    const next = available[(index + step + available.length) % available.length];
    onChange(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  const activeEnabled = options.some((option) => option.value === value && !option.disabledReason);
  const firstEnabled = options.find((option) => !option.disabledReason)?.value;
  return (
    <div role="radiogroup" aria-label={label} className={styles.group} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Tooltip
            key={option.value}
            content={option.disabledReason ?? option.label}
            focusable={Boolean(option.disabledReason)}
          >
            <button
              type="button"
              role="radio"
              aria-checked={active}
              disabled={Boolean(option.disabledReason)}
              tabIndex={(activeEnabled ? active : option.value === firstEnabled) ? 0 : -1}
              data-value={option.value}
              className={cx(styles.segment, active && styles.active)}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

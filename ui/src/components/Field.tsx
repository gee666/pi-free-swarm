import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { charCount } from "../../../src/limits";
import { cx } from "../lib/cx";
import styles from "./Field.module.css";

/** "n/limit" in --text-muted, turning --accent once the limit is exceeded. */
export function CharCounter({ text, limit }: { text: string; limit: number }) {
  const length = charCount(text);
  return (
    <span className={cx(styles.counter, length > limit && styles.over)}>
      {length}/{limit}
    </span>
  );
}

interface AutoTextareaProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Textarea that grows with its content between the CSS min (80px) and max (240px) heights. */
export function AutoTextarea({ value, onChange, label, placeholder, disabled, onKeyDown }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={cx(styles.control, styles.textarea)}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Shows a CharCounter after the input. */
  limit?: number;
  disabled?: boolean;
}

/** Single-line 44px input. */
export function TextField({ value, onChange, label, placeholder, limit, disabled }: TextFieldProps) {
  return (
    <div className={styles.inputWrap}>
      <input
        className={cx(styles.control, styles.input)}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {limit !== undefined && <CharCounter text={value} limit={limit} />}
    </div>
  );
}

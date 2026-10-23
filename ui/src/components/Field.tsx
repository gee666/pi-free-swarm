import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from "react";
import { charCount } from "../../../src/limits";
import { cx } from "../lib/cx";
import styles from "./Field.module.css";

/** Show the counter only as the character limit approaches. */
export function CharCounter({ text, limit }: { text: string; limit: number }) {
  const length = charCount(text);
  if (length < limit * 0.8) return null;
  return (
    <span className={cx(styles.counter, length > limit && styles.over)} data-character-counter>
      {length}/{limit}
    </span>
  );
}

interface AutoTextareaProps extends Pick<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onSelect" | "aria-autocomplete" | "aria-controls" | "aria-activedescendant"
> {
  inputRef?: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Height follows content; CSS caps it at eight lines. */
export function AutoTextarea({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  onKeyDown,
  inputRef,
  ...inputProps
}: AutoTextareaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? internalRef;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [value, ref]);
  return (
    <textarea
      ref={ref}
      className={cx(styles.control, styles.textarea)}
      {...inputProps}
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

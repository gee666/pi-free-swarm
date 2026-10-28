import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AutoTextarea } from "../Field";
import { Popover } from "../Popover";
import styles from "./Mentions.module.css";

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  names: readonly string[];
  label: string;
  placeholder: string;
  disabled?: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function MentionTextarea({
  value,
  onChange,
  names,
  label,
  placeholder,
  disabled,
  onKeyDown,
}: MentionTextareaProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);
  const match = value.slice(0, cursor).match(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_]*)$/u);
  const query = match?.[1];
  const candidates =
    query === undefined ? [] : names.filter((name) => name.toLowerCase().startsWith(query.toLowerCase()));
  const open = !disabled && !dismissed && candidates.length > 0;
  const selected = Math.min(active, candidates.length - 1);

  useLayoutEffect(() => {
    if (pendingCursor === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(pendingCursor, pendingCursor);
    setPendingCursor(null);
  }, [value, pendingCursor]);

  const pick = (name: string) => {
    if (query === undefined) return;
    const start = cursor - query.length - 1;
    const replacement = `@${name} `;
    onChange(value.slice(0, start) + replacement + value.slice(cursor));
    const nextCursor = start + replacement.length;
    setCursor(nextCursor);
    setPendingCursor(nextCursor);
    setDismissed(true);
  };
  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((selected + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      const name = candidates[selected];
      if ((event.key === "Enter" || event.key === "Tab") && name !== undefined) {
        event.preventDefault();
        pick(name);
        return;
      }
    }
    onKeyDown(event);
  };
  return (
    <div className={styles.wrapper}>
      <AutoTextarea
        inputRef={input}
        value={value}
        onChange={(next) => {
          setCursor(input.current?.selectionStart ?? next.length);
          setActive(0);
          setDismissed(false);
          onChange(next);
        }}
        onSelect={(event) => {
          const next = event.currentTarget.selectionStart;
          if (next !== cursor) {
            setCursor(next);
            setActive(0);
            setDismissed(false);
          }
        }}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={handleKey}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${selected}` : undefined}
      />
      <Popover anchorRef={input} open={open} onClose={() => setDismissed(true)}>
        <ul id={listId} role="listbox" aria-label="Mention an agent" className={styles.options}>
          {candidates.map((name, index) => (
            <li
              key={name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              className={index === selected ? styles.active : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(name)}
            >
              @{name}
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

import { rowFocusProps } from "./RowList";
import styles from "./RowButton.module.css";

// A sibling of row content, so names can contain actions without nesting buttons.
export function RowButton({ label, selected, expanded }: { label: string; selected?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      aria-expanded={expanded}
      {...rowFocusProps}
    />
  );
}

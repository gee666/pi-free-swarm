import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { rowFocusProps } from "./RowList";
import styles from "./WorkRow.module.css";

export function WorkRow({
  glyph,
  title,
  subtitle,
  trailing,
  selected,
  mono,
  flush,
  onSelect,
}: {
  glyph: ReactNode;
  title: string;
  subtitle: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  mono?: boolean;
  flush?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      {...rowFocusProps}
      className={cx(styles.row, selected && styles.selected, flush && styles.flush)}
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
    >
      <span className={styles.glyph}>{glyph}</span>
      <span className={styles.text}>
        <span className={cx(styles.title, mono && styles.mono)} title={title}>
          {title}
        </span>{" "}
        <span className={styles.subtitle}>{subtitle}</span>
      </span>{" "}
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </button>
  );
}

import type { ReactNode } from "react";
import styles from "./DetailHeader.module.css";

export function DetailHeader({
  glyph,
  title,
  meta,
  metaLabel,
  actions,
}: {
  glyph: ReactNode;
  title: string;
  meta: ReactNode;
  metaLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        {glyph}
        <h1 title={title}>{title}</h1>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div className={styles.meta} title={metaLabel}>
        {meta}
      </div>
    </header>
  );
}

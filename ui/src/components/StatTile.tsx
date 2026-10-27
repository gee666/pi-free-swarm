import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./StatTile.module.css";

export function StatTile({
  label,
  value,
  accent,
  detail,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  detail?: ReactNode;
}) {
  return (
    <div className={styles.tile}>
      <dt className={styles.label}>{label}</dt>
      <dd className={cx(styles.value, accent && styles.accent)}>{value}</dd>
      {detail && <dd className={styles.detail}>{detail}</dd>}
    </div>
  );
}

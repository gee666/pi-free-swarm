import type { ReactNode } from "react";
import styles from "./Gallery.module.css";

export function Section({ title, column = false, children }: { title: string; column?: boolean; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={column ? styles.column : styles.row}>{children}</div>
    </section>
  );
}

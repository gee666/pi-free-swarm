import type { ReactNode } from "react";
import styles from "./Section.module.css";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

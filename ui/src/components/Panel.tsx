import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./Panel.module.css";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** A bordered box nested inside another panel, e.g. the mailbox rows under the entity header. */
  inset?: boolean;
}

/** Boxed surface: --bg-panel, 1px border, --radius-lg. Children lay out in a column. */
export function Panel({ inset = false, className, children, ...rest }: PanelProps) {
  return (
    <section className={cx(styles.panel, inset && styles.inset, className)} {...rest}>
      {children}
    </section>
  );
}

/** Scrolling region that fills the rest of a panel. */
export function PanelBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.body, className)} {...rest}>
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  /** Optional secondary button on the right. */
  action?: ReactNode;
}

export function PanelHeader({ title, action }: PanelHeaderProps) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {action}
    </header>
  );
}

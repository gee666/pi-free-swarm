import type { ReactNode } from "react";
import styles from "./EntityHeader.module.css";

interface EntityHeaderProps {
  /** Usually `<Avatar size="lg" accent />`. */
  avatar: ReactNode;
  title: ReactNode;
  /** --text-muted line under the title, e.g. "Mailbox". */
  subtitle?: ReactNode;
  /** Controls on the right, e.g. the Inbox/Sent segmented control. */
  actions?: ReactNode;
}

/** Top of the main panel. */
export function EntityHeader({ avatar, title, subtitle, actions }: EntityHeaderProps) {
  return (
    <header className={styles.header}>
      {avatar}
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

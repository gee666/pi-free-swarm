import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./AuthoredEntry.module.css";
import { Avatar } from "./Avatar";
import { AgentName } from "./AgentName";

interface AuthoredEntryProps {
  /** Display name ("You" for the user). */
  author: string;
  /** The `System` sender: info avatar. */
  system?: boolean;
  /** Already formatted, e.g. "10:24 AM". */
  time: string;
  action?: ReactNode;
  /** Marks the user's own entry with the 3px pink bar. */
  own?: boolean;
  /** Body and anything under it, e.g. the delivery list. */
  children: ReactNode;
  className?: string;
}

/** A thread message or wall comment with its author, time and body. */
export function AuthoredEntry({
  author,
  system = false,
  time,
  action,
  own = false,
  children,
  className,
}: AuthoredEntryProps) {
  return (
    <li className={cx(styles.entry, own && styles.own, className)}>
      <Avatar name={author} size="sm" system={system} />
      <div className={styles.main}>
        <div className={styles.head}>
          <span>
            <AgentName className={styles.author} name={author} />
            {action && <span className={styles.action}> {action}</span>}
          </span>
          <span className={styles.time}>{time}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

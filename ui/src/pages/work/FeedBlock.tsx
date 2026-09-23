import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";
import { Icon } from "../../components/Icon";
import { cx } from "../../lib/cx";
import { formatTimestamp } from "../../lib/time";
import styles from "./FeedBlock.module.css";

interface FeedBlockProps {
  /** Header content; the timestamp is added on the right. */
  header: ReactNode;
  timestamp: number;
  /** 3px pink left bar: delivered swarm messages and failed tool calls. */
  marked?: boolean;
  /** Makes the header a toggle (thinking, tool calls); the caller renders the body only while expanded. */
  toggle?: { expanded: boolean; onToggle: () => void };
  children?: ReactNode;
}

/** One entry of the session feed. */
export function FeedBlock({ header, timestamp, marked = false, toggle, children }: FeedBlockProps) {
  const content = (
    <>
      <span className={styles.headerMain}>{header}</span>
      <time className={styles.time} dateTime={new Date(timestamp).toISOString()}>
        {formatTimestamp(timestamp)}
      </time>
    </>
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !toggle?.expanded) return;
    event.stopPropagation();
    toggle.onToggle();
  };
  return (
    <article className={cx(styles.block, marked && styles.marked)} onKeyDown={onKeyDown}>
      {toggle ? (
        <button
          type="button"
          className={cx(styles.header, styles.toggle)}
          aria-expanded={toggle.expanded}
          onClick={toggle.onToggle}
        >
          {content}
          <Icon icon={toggle.expanded ? ChevronUp : ChevronRight} className={styles.chevron} />
        </button>
      ) : (
        <header className={styles.header}>{content}</header>
      )}
      {children && <div className={styles.body}>{children}</div>}
    </article>
  );
}

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import { UnreadDot } from "./Indicators";
import styles from "./MessageRow.module.css";
import { RowButton } from "./RowButton";
import { AgentName } from "./AgentName";

interface MessageRowProps {
  unread?: boolean;
  /** Sender column. */
  sender: string;
  subject: string;
  /** Recipient pill(s) or comment count. */
  meta?: ReactNode;
  /** Aggregate delivery icon, shown just before the time. */
  status?: ReactNode;
  /** Already formatted, e.g. "10:24 AM". */
  time: string;
  expanded: boolean;
  /** Toggles expansion; also called with Esc while expanded. */
  onToggle: () => void;
  /** Body rendered in the raised block while expanded. */
  children?: ReactNode;
}

/** Mailbox message / wall post row. */
export function MessageRow({
  unread = false,
  sender,
  subject,
  meta,
  status,
  time,
  expanded,
  onToggle,
  children,
}: MessageRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !expanded) return;
    event.stopPropagation();
    onToggle();
  };
  return (
    <div className={cx(styles.item, expanded && styles.expanded)} onKeyDown={onKeyDown}>
      <div className={styles.row} onClick={onToggle} data-agent-row>
        <RowButton label={`${sender} ${subject} ${time}`} expanded={expanded} />
        <UnreadDot unread={unread} />
        <AgentName className={styles.sender} name={sender} />
        <span className={styles.subject}>{subject}</span>
        {meta}
        <span className={styles.end}>
          {status}
          <span className={styles.time}>{time}</span>
          <Icon icon={expanded ? ChevronUp : ChevronRight} className={styles.chevron} />
        </span>
      </div>
      {expanded && <div className={styles.body}>{children}</div>}
    </div>
  );
}

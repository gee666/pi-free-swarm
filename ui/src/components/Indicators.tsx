import { cx } from "../lib/cx";
import styles from "./Indicators.module.css";
import { VisuallyHidden } from "./VisuallyHidden";

const BADGE_MAX = 9;

interface CountBadgeProps {
  count: number;
  /** Screen-reader noun after the number. */
  label?: string;
  /** Keep the badge's width at 0 so the icons before it stay aligned across rows. */
  reserveSpace?: boolean;
}

/** Pink unread counter; hidden at 0 and "9+" above 9. */
export function CountBadge({ count, label = "unread", reserveSpace = false }: CountBadgeProps) {
  if (count <= 0) return reserveSpace ? <span className={styles.badgeSpace} /> : null;
  return (
    <span className={styles.badge}>
      <span aria-hidden="true">{count > BADGE_MAX ? `${BADGE_MAX}+` : count}</span>
      <VisuallyHidden>{`${count} ${label}`}</VisuallyHidden>
    </span>
  );
}

/** 8px unread marker. Read rows keep the empty slot so the columns stay aligned. */
export function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span className={cx(styles.unreadDot, unread && styles.unread)}>
      {unread && <VisuallyHidden>Unread</VisuallyHidden>}
    </span>
  );
}

export type AgentStatus = "live" | "idle" | "crashed";

const STATUS_LABEL: Record<AgentStatus, string> = { live: "Working", idle: "Idle", crashed: "Crashed" };

interface StatusDotProps {
  status: AgentStatus;
  /** sm 8px in list rows, md in the top bar. */
  size?: "sm" | "md";
  /** Screen-reader text; defaults to Working / Idle / Crashed. */
  label?: string;
}

export function StatusDot({ status, size = "sm", label = STATUS_LABEL[status] }: StatusDotProps) {
  return (
    <span className={cx(styles.statusDot, styles[size], styles[status])}>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}

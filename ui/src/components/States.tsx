import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "./Icon";
import styles from "./States.module.css";

interface EmptyStateProps {
  icon: LucideIcon;
  text: string;
  /** At most one secondary button. */
  action?: ReactNode;
}

/** Centered placeholder for an empty panel. */
export function EmptyState({ icon, text, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon icon={icon} size="empty" className={styles.emptyIcon} />
      <p className={styles.emptyText}>{text}</p>
      {action}
    </div>
  );
}

interface SkeletonRowsProps {
  count?: number;
  /** Include an avatar circle, for list-panel rows. */
  avatar?: boolean;
}

/** Pulsing placeholder rows; lists never show spinners. */
export function SkeletonRows({ count = 5, avatar = false }: SkeletonRowsProps) {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={avatar ? styles.skeletonRowLarge : styles.skeletonRow}>
          {avatar && <span className={styles.skeletonAvatar} />}
          <span className={styles.skeletonLine} />
        </div>
      ))}
    </div>
  );
}

interface ErrorBannerProps {
  children: ReactNode;
  action?: ReactNode;
}

/** Inline banner at the top of the main panel, e.g. "Connection lost. Reconnecting…". */
export function ErrorBanner({ children, action }: ErrorBannerProps) {
  return (
    <div role="alert" className={styles.banner}>
      <span className={styles.bannerText}>{children}</span>
      {action}
    </div>
  );
}

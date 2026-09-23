import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./Pill.module.css";
import { Icon } from "./Icon";

interface PillProps {
  /** Muted leading word, e.g. "to". */
  prefix?: string;
  icon?: LucideIcon;
  title?: string;
  children: ReactNode;
}

/** Neutral pill: "to Maria", "you", comment counts. */
export function Pill({ prefix, icon, title, children }: PillProps) {
  return (
    <span className={styles.pill} title={title}>
      {icon && <Icon icon={icon} size="status" className={styles.icon} />}
      {prefix && <span className={styles.prefix}>{prefix}</span>}
      <span className={styles.value}>{children}</span>
    </span>
  );
}

const MAX_LISTED = 2;

/** "Maria", "Maria, John", or "Maria +2" once there are more than two names. */
function formatRecipients(names: readonly string[]): string {
  if (names.length <= MAX_LISTED) return names.join(", ");
  return `${names[0]} +${names.length - 1}`;
}

export function RecipientPill({ names, prefix = "to" }: { names: readonly string[]; prefix?: string }) {
  return (
    <Pill prefix={prefix} title={names.length > MAX_LISTED ? names.join(", ") : undefined}>
      {formatRecipients(names)}
    </Pill>
  );
}

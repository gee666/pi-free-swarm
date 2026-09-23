import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Avatar } from "./Avatar";
import styles from "./ListRow.module.css";
import { rowFocusProps } from "./RowList";

interface ListRowProps {
  /** Name the avatar initial comes from; the avatar turns accent when selected. */
  avatar: string;
  /** md (48px) for participants, sm (32px) for wall posts. */
  avatarSize?: "sm" | "md";
  title: ReactNode;
  /** Inline after the title, e.g. the "you" pill. */
  titleAddon?: ReactNode;
  /** Second line in --text-muted --fs-small. */
  subtitle?: ReactNode;
  /** Right side: status dot, envelope button, badge. May hold its own buttons. */
  trailing?: ReactNode;
  selected?: boolean;
  onSelect: () => void;
}

/** The canonical 72px row of the list panel. */
export function ListRow({
  avatar,
  avatarSize = "md",
  title,
  titleAddon,
  subtitle,
  trailing,
  selected = false,
  onSelect,
}: ListRowProps) {
  return (
    <div className={cx(styles.row, selected && styles.selected)}>
      <button
        type="button"
        className={styles.main}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        {...rowFocusProps}
      >
        <Avatar name={avatar} size={avatarSize} accent={selected} />
        <span className={styles.text}>
          <span className={styles.titleLine}>
            <span className={styles.title}>{title}</span>
            {titleAddon}
          </span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </span>
      </button>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}

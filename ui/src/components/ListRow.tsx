import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Avatar } from "./Avatar";
import styles from "./ListRow.module.css";
import { RowButton } from "./RowButton";

interface ListRowProps {
  /** Name the avatar initial comes from; the avatar turns accent when selected. */
  avatar: string;
  /** md for participants, sm for wall posts. */
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

/** Shared selectable list row. */
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
    <div className={cx(styles.row, selected && styles.selected)} data-agent-row>
      <div className={styles.main} onClick={onSelect}>
        <RowButton label={typeof title === "string" ? title : avatar} selected={selected} />
        <Avatar name={avatar} size={avatarSize} accent={selected} />
        <span className={styles.text}>
          <span className={styles.titleLine}>
            <span className={styles.title}>{title}</span>
            {titleAddon}
          </span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </span>
      </div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}

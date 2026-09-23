import { Info } from "lucide-react";
import { cx } from "../lib/cx";
import styles from "./Avatar.module.css";

type AvatarSize = "xs" | "sm" | "md" | "lg";

interface AvatarProps {
  name: string;
  /** xs 20px (delivery lines), sm 32px (inline lists), md 48px (list rows), lg 64px (entity header). */
  size?: AvatarSize;
  /** Accent fill for the selected or current entity. */
  accent?: boolean;
  /** The `System` sender: an info icon instead of an initial. */
  system?: boolean;
}

export function Avatar({ name, size = "md", accent = false, system = false }: AvatarProps) {
  return (
    <span className={cx(styles.avatar, styles[size], accent && styles.accent)} aria-hidden="true">
      {system ? <Info className={styles.icon} strokeWidth={1.75} /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

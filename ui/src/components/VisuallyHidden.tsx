import type { ReactNode } from "react";
import styles from "./VisuallyHidden.module.css";

/** Text for screen readers only, e.g. the meaning of a coloured dot. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}

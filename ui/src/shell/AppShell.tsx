import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  topBar: ReactNode;
  /** The TabRail inside a swarm; omitted on the picker. */
  rail?: ReactNode;
  children: ReactNode;
}

/** Full-viewport frame: the page never scrolls, panels scroll internally. */
export function AppShell({ topBar, rail, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      {topBar}
      <div className={styles.body}>
        {rail}
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

interface PanelLayoutProps {
  /** The 350px list panel. */
  list: ReactNode;
  /** The main panel. */
  main: ReactNode;
  /** Optional compose panel above the newest content. */
  compose?: ReactNode;
}

/** List panel and main column with compose above the main panel. */
export function PanelLayout({ list, main, compose }: PanelLayoutProps) {
  return (
    <div className={styles.columns}>
      <div className={styles.list}>{list}</div>
      <div className={styles.mainColumn}>
        {compose}
        {main}
      </div>
    </div>
  );
}

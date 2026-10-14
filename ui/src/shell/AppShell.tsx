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
  /** The list panel. */
  list: ReactNode;
  /** The main panel. */
  main: ReactNode;
  /** Optional composer pinned below the scrolling content. */
  compose?: ReactNode;
  listWidth?: string;
}

export function PanelLayout({ list, main, compose, listWidth }: PanelLayoutProps) {
  return (
    <div className={styles.columns}>
      <div className={styles.list} style={listWidth ? { width: listWidth } : undefined}>
        {list}
      </div>
      <div className={styles.mainColumn}>
        {main}
        {compose}
      </div>
    </div>
  );
}

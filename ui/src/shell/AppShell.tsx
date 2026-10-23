import type { CSSProperties, ReactNode } from "react";
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
  const listStyle: CSSProperties & { "--list-width"?: string } = { "--list-width": listWidth };
  return (
    <div className={styles.columns}>
      <div className={styles.list} style={listStyle}>
        {list}
      </div>
      <div className={styles.mainColumn}>
        {main}
        {compose}
      </div>
    </div>
  );
}

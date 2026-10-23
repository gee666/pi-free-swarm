import { NavLink } from "react-router-dom";
import { ChartColumn, MessageSquare, Settings, SquareTerminal, Users, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { Icon } from "../components/Icon";
import { CountBadge } from "../components/Indicators";
import type { UserUnreadSummary } from "../../../src/api-types";
import styles from "./TabRail.module.css";

const TABS: ReadonlyArray<{ path: string; label: string; icon: LucideIcon; unread?: keyof UserUnreadSummary }> = [
  { path: "agents", label: "Agents", icon: Users, unread: "messages" },
  { path: "wall", label: "Wall", icon: MessageSquare, unread: "comments" },
  { path: "work", label: "Work", icon: SquareTerminal },
  { path: "watcher", label: "Watcher", icon: MessageSquare },
  { path: "stats", label: "Stats", icon: ChartColumn },
  { path: "config", label: "Config", icon: Settings },
];

/** Vertical tab rail; `basePath` is the swarm root, e.g. "/s/3". */
export function TabRail({ basePath, unread }: { basePath: string; unread?: UserUnreadSummary }) {
  return (
    <nav className={styles.rail} aria-label="Sections">
      {TABS.map((tab) => {
        const count = tab.unread && unread ? unread[tab.unread] : 0;
        return (
          <NavLink
            key={tab.path}
            to={`${basePath}/${tab.path}`}
            className={({ isActive }) => cx(styles.tab, isActive && styles.active)}
          >
            <Icon icon={tab.icon} size="rail" />
            {tab.label}
            {count > 0 && (
              <span className={styles.tabBadge}>
                <CountBadge count={count} label={`unread ${tab.unread}`} />
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

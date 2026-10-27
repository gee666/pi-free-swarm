import { NavLink } from "react-router-dom";
import {
  ChartColumn,
  LayoutDashboard,
  ListChecks,
  SquareKanban,
  Puzzle,
  MessageSquare,
  Settings,
  SquareTerminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../lib/cx";
import { Icon } from "../components/Icon";
import { CountBadge } from "../components/Indicators";
import type { UserUnreadSummary } from "../../../src/api-types";
import styles from "./TabRail.module.css";

const TABS: ReadonlyArray<{ path: string; label: string; icon: LucideIcon; unread?: keyof UserUnreadSummary }> = [
  { path: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "criteria", label: "Criteria", icon: ListChecks },
  { path: "tasks", label: "Tasks", icon: SquareKanban },
  { path: "wall", label: "Wall", icon: MessageSquare, unread: "comments" },
  { path: "agents", label: "Agents", icon: Users, unread: "messages" },
  { path: "work", label: "Work", icon: SquareTerminal },
  { path: "skills", label: "Skills", icon: Puzzle },
  { path: "watcher", label: "Watcher", icon: MessageSquare },
  { path: "stats", label: "Stats", icon: ChartColumn },
  { path: "config", label: "Config", icon: Settings },
];

/** Vertical tab rail; `basePath` is the swarm root, e.g. "/s/3". */
export function TabRail({
  basePath,
  unread,
  attention = 0,
}: {
  basePath: string;
  unread?: UserUnreadSummary;
  attention?: number;
}) {
  return (
    <nav className={styles.rail} aria-label="Sections">
      {TABS.map((tab) => {
        const count = tab.path === "criteria" ? attention : tab.unread && unread ? unread[tab.unread] : 0;
        const label = tab.path === "criteria" ? "attention items" : `unread ${tab.unread}`;
        return (
          <NavLink
            key={tab.path}
            to={`${basePath}/${tab.path}`}
            aria-label={count > 0 ? `${tab.label} ${count} ${label}` : undefined}
            className={({ isActive }) => cx(styles.tab, isActive && styles.active)}
          >
            <Icon icon={tab.icon} size="rail" />
            {tab.label}
            {count > 0 && (
              <span className={styles.tabBadge}>
                <CountBadge count={count} label={label} />
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

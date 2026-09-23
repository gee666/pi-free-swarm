import { NavLink } from "react-router-dom";
import { ChartColumn, MessageSquare, SquareTerminal, Users, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { Icon } from "../components/Icon";
import styles from "./TabRail.module.css";

const TABS: ReadonlyArray<{ path: string; label: string; icon: LucideIcon }> = [
  { path: "agents", label: "Agents", icon: Users },
  { path: "wall", label: "Wall", icon: MessageSquare },
  { path: "work", label: "Work", icon: SquareTerminal },
  { path: "stats", label: "Stats", icon: ChartColumn },
];

/** Vertical tab rail; `basePath` is the swarm root, e.g. "/s/3". */
export function TabRail({ basePath }: { basePath: string }) {
  return (
    <nav className={styles.rail} aria-label="Sections">
      {TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={`${basePath}/${tab.path}`}
          className={({ isActive }) => cx(styles.tab, isActive && styles.active)}
        >
          <Icon icon={tab.icon} size="rail" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

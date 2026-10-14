import { ChartColumn, Mail, SquareTerminal, type LucideIcon } from "lucide-react";
import { useInRouterContext, useLocation, useNavigate, useParams } from "react-router-dom";
import { cx } from "../lib/cx";
import { agentDestination, type AgentAction } from "../lib/agentNavigation";
import { IconButton } from "./Button";
import { Tooltip } from "./Tooltip";
import styles from "./AgentName.module.css";

const ACTIONS: ReadonlyArray<{ action: AgentAction; label: string; icon: LucideIcon }> = [
  { action: "work", label: "Open work", icon: SquareTerminal },
  { action: "stats", label: "Show stats", icon: ChartColumn },
  { action: "compose", label: "Send message", icon: Mail },
];
const RESERVED_NAMES = new Set(["user", "you", "main", "system"]);

export function AgentName({ name, className }: { name: string; className?: string }) {
  const routed = useInRouterContext();
  return (
    <span className={cx(styles.name, className)} data-agent-name>
      <span className={styles.anchor}>
        <span className={styles.label}>{name}</span>
        {routed && !RESERVED_NAMES.has(name.toLowerCase()) && <AgentActions name={name} />}
      </span>
    </span>
  );
}

function AgentActions({ name }: { name: string }) {
  const { id, name: selected } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  if (!id) return null;
  const statsAgent = new URLSearchParams(location.search).get("agent");
  const sameAgent = (other: string | null | undefined) => other?.toLowerCase() === name.toLowerCase();
  return (
    <span className={styles.actions} onClick={(event) => event.stopPropagation()}>
      {ACTIONS.filter(({ action }) => {
        if (action === "work") return !(location.pathname.includes("/work/") && sameAgent(selected));
        if (action === "stats") return !(location.pathname.endsWith("/stats") && sameAgent(statsAgent));
        return true;
      }).map(({ action, label, icon }) => (
        <Tooltip key={action} content={`${label}: ${name}`}>
          <IconButton
            icon={icon}
            iconSize="status"
            label={`${label}: ${name}`}
            className={styles.action}
            onClick={() => navigate(agentDestination(id, name, action))}
          />
        </Tooltip>
      ))}
    </span>
  );
}

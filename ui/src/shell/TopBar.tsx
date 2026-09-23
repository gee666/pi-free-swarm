import { FileText } from "lucide-react";
import type { SwarmListItem } from "../../../src/api-types";
import { Icon } from "../components/Icon";
import { StatusDot } from "../components/Indicators";
import { Tooltip } from "../components/Tooltip";
import { isSwarmLive, swarmStatusLabel } from "../lib/swarmStatus";
import { Logo } from "./Logo";
import { SwarmSelect } from "./SwarmSelect";
import styles from "./TopBar.module.css";

interface TopBarProps {
  swarms: readonly SwarmListItem[];
  /** Omit on the picker: the dropdown reads "Select a swarm" and prompt/status are hidden. */
  current?: SwarmListItem;
  onSelectSwarm: (id: number) => void;
}

export function TopBar({ swarms, current, onSelectSwarm }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <Logo className={styles.logo} />
        <span className={styles.title}>Pi Swarm</span>
      </div>
      <SwarmSelect swarms={swarms} currentId={current?.id} onSelect={onSelectSwarm} />
      {current && <CurrentSwarm swarm={current} />}
    </header>
  );
}

function CurrentSwarm({ swarm }: { swarm: SwarmListItem }) {
  const status = swarmStatusLabel(swarm);
  return (
    <>
      <Tooltip content={swarm.taskPrompt} className={styles.prompt}>
        <Icon icon={FileText} className={styles.promptIcon} />
        <span className={styles.promptText} tabIndex={0}>
          {swarm.taskPrompt}
        </span>
      </Tooltip>
      <div className={styles.status}>
        <StatusDot status={isSwarmLive(swarm.status) ? "live" : "idle"} size="md" label={status} />
        <span aria-hidden="true">{status}</span>
      </div>
    </>
  );
}

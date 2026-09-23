import { ChevronRight } from "lucide-react";
import type { SwarmListItem } from "../../../../src/api-types";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Indicators";
import { Pill } from "../../components/Pill";
import { rowFocusProps } from "../../components/RowList";
import { agentCountLabel, isSwarmLive, swarmStatusLabel } from "../../lib/swarmStatus";
import { formatTimestamp } from "../../lib/time";
import styles from "./PickerPage.module.css";

export function SwarmRow({ swarm, onOpen }: { swarm: SwarmListItem; onOpen: () => void }) {
  return (
    <button type="button" className={styles.row} onClick={onOpen} {...rowFocusProps}>
      <StatusDot status={isSwarmLive(swarm.status) ? "live" : "idle"} label={swarmStatusLabel(swarm)} />
      <span className={styles.id}>#{swarm.id}</span>
      <span className={styles.name}>{swarm.name}</span>
      <span className={styles.prompt}>{swarm.taskPrompt}</span>
      <Pill>{agentCountLabel(swarm)}</Pill>
      <span className={styles.time}>{formatTimestamp(swarm.createdAt)}</span>
      <Icon icon={ChevronRight} className={styles.chevron} />
    </button>
  );
}

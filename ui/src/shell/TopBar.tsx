import { AcceptanceSummary } from "../components/AcceptanceSummary";
import { RunConfiguration } from "../components/RunConfiguration";
import { BudgetSummary } from "../components/BudgetSummary";
import { InitialTask } from "../components/InitialTask";
import type { SwarmDetailResponse, SwarmListItem } from "../../../src/api-types";
import { StatusDot } from "../components/Indicators";
import { isSwarmLive, swarmStatusLabel } from "../lib/swarmStatus";
import { Logo } from "./Logo";
import { SwarmSelect } from "./SwarmSelect";
import styles from "./TopBar.module.css";

interface TopBarProps {
  swarms: readonly SwarmListItem[];
  /** Omit on the picker: the dropdown reads "Select a swarm" and status is hidden. */
  current?: SwarmListItem;
  detail?: SwarmDetailResponse;
  onSelectSwarm: (id: number) => void;
}

export function TopBar({ swarms, current, detail, onSelectSwarm }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <Logo className={styles.logo} />
        <span className={styles.title}>Pi Swarm</span>
      </div>
      <SwarmSelect swarms={swarms} currentId={current?.id} onSelect={onSelectSwarm} />
      {current && <CurrentSwarm swarm={current} detail={detail} />}
    </header>
  );
}

function CurrentSwarm({ swarm, detail }: { swarm: SwarmListItem; detail?: SwarmDetailResponse }) {
  const status = swarmStatusLabel(swarm);
  return (
    <div className={styles.status}>
      <StatusDot status={isSwarmLive(swarm.status) ? "live" : "idle"} size="md" label={status} />
      <span aria-hidden="true">{status}</span>
      <InitialTask key={swarm.id} task={swarm.taskPrompt} />
      {detail && <AcceptanceSummary detail={detail} />}
      {detail && <RunConfiguration configuration={detail.swarm.configuration} />}
      {detail && <BudgetSummary budget={detail.swarm.budget} />}
    </div>
  );
}

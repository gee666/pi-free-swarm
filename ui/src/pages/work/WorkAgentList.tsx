import type { AgentParticipantView } from "../../../../src/api-types";
import { StatusDot } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { PanelBody } from "../../components/Panel";
import { RowList } from "../../components/RowList";
import { formatCost } from "../../lib/format";
import { agentDotStatus } from "../../lib/swarmStatus";
import { activityLabel } from "./activity";
import styles from "./Work.module.css";

interface WorkAgentListProps {
  agents: readonly AgentParticipantView[];
  selected: string | undefined;
  onSelect: (name: string) => void;
}

/** Agents with their current activity and cost; the user has no session and is not listed. */
export function WorkAgentList({ agents, selected, onSelect }: WorkAgentListProps) {
  return (
    <PanelBody>
      <RowList>
        {agents.map((agent) => (
          <ListRow
            key={agent.name}
            avatar={agent.name}
            title={agent.name}
            subtitle={activityLabel(agent)}
            selected={agent.name === selected}
            onSelect={() => onSelect(agent.name)}
            trailing={
              <>
                <StatusDot status={agentDotStatus(agent.status)} />
                <span className={styles.cost}>{formatCost(agent.cost)}</span>
              </>
            }
          />
        ))}
      </RowList>
    </PanelBody>
  );
}

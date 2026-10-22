import { WATCHER_NAME } from "../../../../src/constants";
import type { ParticipantView } from "../../../../src/api-types";
import { AgentName } from "../../components/AgentName";
import { WorkerModel } from "../../components/WorkerModel";
import { CountBadge, StatusDot } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { Panel, PanelBody } from "../../components/Panel";
import { Pill } from "../../components/Pill";
import { RowList } from "../../components/RowList";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { agentDotStatus } from "../../lib/swarmStatus";

interface ParticipantListProps {
  /** User and Watcher are pinned above the active agents. */
  participants: readonly ParticipantView[] | undefined;
  error: Error | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
}

export function ParticipantList({ participants, error, selected, onSelect }: ParticipantListProps) {
  const rank = (participant: ParticipantView) =>
    participant.kind === "user" ? 0 : participant.name === WATCHER_NAME ? 1 : 2;
  const ordered = participants && [...participants].sort((a, b) => rank(a) - rank(b));
  return (
    <Panel aria-label="Agents">
      {error && <ErrorBanner>{`Could not load agents: ${error.message}`}</ErrorBanner>}
      {participants === undefined ? (
        !error && <SkeletonRows avatar count={8} />
      ) : (
        <PanelBody>
          <RowList>
            {ordered?.map((participant) =>
              participant.kind === "user" ? (
                <ListRow
                  key={participant.name}
                  avatar="You"
                  title={participant.name}
                  titleAddon={<Pill>you</Pill>}
                  selected={participant.name === selected}
                  onSelect={() => onSelect(participant.name)}
                  trailing={<CountBadge count={participant.unread} reserveSpace />}
                />
              ) : (
                <ListRow
                  key={participant.name}
                  avatar={participant.name}
                  title={<AgentName name={participant.name} />}
                  subtitle={<WorkerModel model={participant.model} />}
                  selected={participant.name === selected}
                  onSelect={() => onSelect(participant.name)}
                  trailing={
                    <>
                      <StatusDot status={agentDotStatus(participant.status)} />
                      <CountBadge count={participant.unread} reserveSpace />
                    </>
                  }
                />
              ),
            )}
          </RowList>
        </PanelBody>
      )}
    </Panel>
  );
}

import type { ParticipantView } from "../../../../src/api-types";
import { AgentName } from "../../components/AgentName";
import { CountBadge, StatusDot } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { Pill } from "../../components/Pill";
import { RowList } from "../../components/RowList";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { agentDotStatus } from "../../lib/swarmStatus";

interface ParticipantListProps {
  /** Most recently active participants first. */
  participants: readonly ParticipantView[] | undefined;
  error: Error | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
}

export function ParticipantList({ participants, error, selected, onSelect }: ParticipantListProps) {
  return (
    <Panel aria-label="Agents">
      <PanelHeader title="Agents" />
      {error && <ErrorBanner>{`Could not load agents: ${error.message}`}</ErrorBanner>}
      {participants === undefined ? (
        !error && <SkeletonRows avatar count={8} />
      ) : (
        <PanelBody>
          <RowList>
            {participants.map((participant) =>
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

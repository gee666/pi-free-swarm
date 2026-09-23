import { Mail } from "lucide-react";
import type { ParticipantView } from "../../../../src/api-types";
import { IconButton } from "../../components/Button";
import { CountBadge, StatusDot } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { Pill } from "../../components/Pill";
import { RowList } from "../../components/RowList";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { agentDotStatus } from "../../lib/swarmStatus";

interface ParticipantListProps {
  /** `User` first, then agents by launch order (the API's order). */
  participants: readonly ParticipantView[] | undefined;
  error: Error | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
  /** Envelope button: start a message to this agent. */
  onMessage: (name: string) => void;
}

export function ParticipantList({ participants, error, selected, onSelect, onMessage }: ParticipantListProps) {
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
                  title={participant.name}
                  selected={participant.name === selected}
                  onSelect={() => onSelect(participant.name)}
                  trailing={
                    <>
                      <StatusDot status={agentDotStatus(participant.status)} />
                      <IconButton
                        icon={Mail}
                        label={`Message ${participant.name}`}
                        onClick={() => onMessage(participant.name)}
                      />
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

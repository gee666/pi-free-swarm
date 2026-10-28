import { Link, useNavigate, useParams } from "react-router-dom";
import { UserX } from "lucide-react";
import { USER_NAME } from "../../api/agents";
import { Avatar } from "../../components/Avatar";
import { AgentName } from "../../components/AgentName";
import { EntityHeader } from "../../components/EntityHeader";
import { Panel, PanelBody } from "../../components/Panel";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";
import { activityLabel } from "../work/activity";
import { ParticipantList } from "./ParticipantList";
import { useSwarmDetail } from "./useSwarmDetail";

export function AgentsPage() {
  const { id: swarmId = "", name = USER_NAME } = useParams();
  const navigate = useNavigate();
  const detail = useSwarmDetail(swarmId);
  const participants = detail.data?.participants;
  const selected = participants?.find((participant) => participant.name.toLowerCase() === name.toLowerCase());
  return (
    <PanelLayout
      list={
        <ParticipantList
          participants={participants}
          error={detail.error}
          selected={selected?.name}
          onSelect={(next) => navigate(`/s/${swarmId}/agents/${encodeURIComponent(next)}`)}
        />
      }
      main={
        <Panel aria-label="Participant">
          {detail.error && <ErrorBanner>{detail.error.message}</ErrorBanner>}
          {selected ? (
            <>
              <EntityHeader
                avatar={<Avatar name={selected.name} />}
                title={<AgentName name={selected.name} />}
                subtitle={selected.kind === "agent" ? selected.status : "User"}
              />
              <PanelBody>
                {selected.kind === "agent" ? (
                  <>
                    <p>{activityLabel(selected)}</p>
                    <Link to={`/s/${swarmId}/work/${encodeURIComponent(selected.name)}`}>View activity in Work</Link>
                  </>
                ) : (
                  <Link to={`/s/${swarmId}/wall`}>Open the Wall</Link>
                )}
              </PanelBody>
            </>
          ) : participants === undefined ? (
            <SkeletonRows />
          ) : (
            <EmptyState icon={UserX} text="Participant not found" />
          )}
        </Panel>
      }
    />
  );
}

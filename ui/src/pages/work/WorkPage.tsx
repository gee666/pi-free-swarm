import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Users } from "lucide-react";
import type { AgentParticipantView, ParticipantView } from "../../../../src/api-types";
import { useSwarmStream } from "../../api/SwarmStream";
import { AgentName } from "../../components/AgentName";
import { Button } from "../../components/Button";
import { StatusDot } from "../../components/Indicators";
import { agentDotStatus } from "../../lib/swarmStatus";
import styles from "./Work.module.css";
import { Panel } from "../../components/Panel";
import { agentDestination } from "../../lib/agentNavigation";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";
import { useSwarmDetail } from "../agents/useSwarmDetail";
import { SessionFeed } from "./SessionFeed";
import { WorkAgentList } from "./WorkAgentList";

const isAgent = (participant: ParticipantView): participant is AgentParticipantView => participant.kind === "agent";

/** Work tab: every agent's live pi session, newest first. */
export function WorkPage() {
  const { id = "", name } = useParams();
  const navigate = useNavigate();
  const stream = useSwarmStream();
  const detail = useSwarmDetail(id);

  const agents = detail.data?.participants.filter(isAgent) ?? [];
  const agentPath = (agent: string) => agentDestination(id, agent, "work");
  if (name === undefined && agents.length > 0) return <Navigate to={agentPath(agents[0].name)} replace />;
  const selected = agents.find((agent) => agent.name.toLowerCase() === name?.toLowerCase());

  const main = () => {
    if (!detail.data) return detail.error ? null : <SkeletonRows avatar />;
    if (agents.length === 0) return <EmptyState icon={Users} text="No agents yet" />;
    if (!selected) return <EmptyState icon={Users} text="Agent not found" />;
    return (
      <>
        <header className={styles.header}>
          <AgentName name={selected.name} />
          <StatusDot status={agentDotStatus(selected.status)} />
          <span className={styles.state}>{selected.status}</span>
        </header>
        <SessionFeed key={selected.name} swarmId={id} agent={selected.name} stream={stream} />
      </>
    );
  };

  return (
    <PanelLayout
      list={
        <Panel>
          {detail.data ? (
            <WorkAgentList agents={agents} selected={selected?.name} onSelect={(agent) => navigate(agentPath(agent))} />
          ) : (
            !detail.error && <SkeletonRows avatar />
          )}
        </Panel>
      }
      main={
        <Panel>
          {stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>}
          {detail.error && (
            <ErrorBanner action={<Button onClick={detail.reload}>Retry</Button>}>
              {`Could not load the agents: ${detail.error.message}`}
            </ErrorBanner>
          )}
          {main()}
        </Panel>
      }
    />
  );
}

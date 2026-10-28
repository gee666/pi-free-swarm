import { useSwarmDetail } from "../pages/agents/useSwarmDetail";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { SwarmViewProvider } from "../api/SwarmView";
import { useSwarmList } from "../api/SwarmList";
import { DashboardProvider, useDashboard } from "../api/dashboard";
import { AppShell } from "./AppShell";
import { TabRail } from "./TabRail";
import { TopBar } from "./TopBar";
import { FilePreviewProvider } from "../components/FilePreview";

/** Keep the global selector live while activity remains on its separate swarm-filtered stream. */
export function SwarmLayout() {
  const { id = "" } = useParams();
  return (
    <SwarmViewProvider key={id} swarmId={id}>
      <FilePreviewProvider swarmId={id}>
        <DashboardProvider swarmId={id}>
          <SwarmFrame swarmId={id} />
        </DashboardProvider>
      </FilePreviewProvider>
    </SwarmViewProvider>
  );
}

function SwarmFrame({ swarmId }: { swarmId: string }) {
  const navigate = useNavigate();
  const { list } = useSwarmList();
  const detail = useSwarmDetail(swarmId);
  const dashboard = useDashboard().data;
  const swarms = list.data?.swarms ?? [];
  return (
    <AppShell
      topBar={
        <TopBar
          detail={detail.data}
          runState={dashboard?.header.state}
          swarms={swarms}
          current={swarms.find((swarm) => String(swarm.id) === swarmId) ?? detail.data?.swarm}
          currentId={Number(swarmId)}
          onSelectSwarm={(id) => navigate(`/s/${id}/dashboard`)}
        />
      }
      rail={<TabRail basePath={`/s/${swarmId}`} unread={detail.data?.userUnread} />}
    >
      <Outlet />
    </AppShell>
  );
}

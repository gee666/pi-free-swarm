import { useSwarmDetail } from "../pages/agents/useSwarmDetail";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { SwarmStreamProvider } from "../api/SwarmStream";
import { useSwarmList } from "../api/SwarmList";
import { AppShell } from "./AppShell";
import { TabRail } from "./TabRail";
import { TopBar } from "./TopBar";

/** Keep the global selector live while activity remains on its separate swarm-filtered stream. */
export function SwarmLayout() {
  const { id = "" } = useParams();
  return (
    <SwarmStreamProvider key={id} swarmId={id}>
      <SwarmFrame swarmId={id} />
    </SwarmStreamProvider>
  );
}

function SwarmFrame({ swarmId }: { swarmId: string }) {
  const navigate = useNavigate();
  const { list } = useSwarmList();
  const detail = useSwarmDetail(swarmId);
  const swarms = list.data?.swarms ?? [];
  return (
    <AppShell
      topBar={
        <TopBar
          detail={detail.data}
          swarms={swarms}
          current={swarms.find((swarm) => String(swarm.id) === swarmId)}
          onSelectSwarm={(id) => navigate(`/s/${id}/agents`)}
        />
      }
      rail={<TabRail basePath={`/s/${swarmId}`} />}
    >
      <Outlet />
    </AppShell>
  );
}

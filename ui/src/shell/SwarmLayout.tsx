import { Outlet, useNavigate, useParams } from "react-router-dom";
import { fetchSwarms, withSwarm } from "../api/swarms";
import { SwarmStreamProvider, useSwarmStream } from "../api/SwarmStream";
import { useAsync } from "../api/useAsync";
import { useStreamListener } from "../api/useEventStream";
import { AppShell } from "./AppShell";
import { TabRail } from "./TabRail";
import { TopBar } from "./TopBar";

/** Shell for every `/s/:id/*` page; owns the swarm's single event stream. */
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
  const stream = useSwarmStream();
  const list = useAsync(fetchSwarms, [stream.openCount]);
  useStreamListener(stream, (event) => {
    if (event.type === "swarm.updated") list.update((current) => withSwarm(current, event.payload.swarm));
  });
  const swarms = list.data?.swarms ?? [];
  return (
    <AppShell
      topBar={
        <TopBar
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

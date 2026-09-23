import { useNavigate } from "react-router-dom";
import { Network } from "lucide-react";
import { fetchSwarms, withSwarm } from "../../api/swarms";
import { useAsync } from "../../api/useAsync";
import { useEventStream, useStreamListener } from "../../api/useEventStream";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList } from "../../components/RowList";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { AppShell } from "../../shell/AppShell";
import { TopBar } from "../../shell/TopBar";
import styles from "./PickerPage.module.css";
import { SwarmRow } from "./SwarmRow";

/** Home: every swarm of this folder, newest first. */
export function PickerPage() {
  const navigate = useNavigate();
  const stream = useEventStream("/events");
  const list = useAsync(fetchSwarms, [stream.openCount]);
  useStreamListener(stream, (event) => {
    if (event.type === "swarm.updated") list.update((current) => withSwarm(current, event.payload.swarm));
  });
  const swarms = list.data?.swarms ?? [];
  const open = (id: number) => navigate(`/s/${id}/agents`);

  return (
    <AppShell topBar={<TopBar swarms={swarms} onSelectSwarm={open} />}>
      <Panel className={styles.panel}>
        <PanelHeader title="Swarms" />
        {stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>}
        {list.error && <ErrorBanner>{`Could not load swarms: ${list.error.message}`}</ErrorBanner>}
        {list.data === undefined && !list.error ? (
          <SkeletonRows />
        ) : swarms.length === 0 ? (
          <EmptyState icon={Network} text="No swarms yet. Ask pi to start one." />
        ) : (
          <PanelBody>
            <RowList>
              {swarms.map((swarm) => (
                <SwarmRow key={swarm.id} swarm={swarm} onOpen={() => open(swarm.id)} />
              ))}
            </RowList>
          </PanelBody>
        )}
      </Panel>
    </AppShell>
  );
}

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Network } from "lucide-react";
import { latestRunningSwarm } from "../../api/swarms";
import { useSwarmList } from "../../api/SwarmList";
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
  const { list, stream } = useSwarmList();
  const initialChoice = useRef(false);
  useEffect(() => {
    if (initialChoice.current || list.loading || list.error || list.data === undefined) return;
    initialChoice.current = true;
    const current = latestRunningSwarm(list.data.swarms);
    if (current) navigate(`/s/${current.id}/dashboard`, { replace: true });
  }, [list.data, list.loading, list.error, navigate]);
  const swarms = list.data?.swarms ?? [];
  const open = (id: number) => navigate(`/s/${id}/dashboard`);

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

import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { ChartColumn } from "lucide-react";
import { fetchStats } from "../../api/stats";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { Button } from "../../components/Button";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { AgentStatsTable } from "./AgentStatsTable";
import { StatTiles } from "./StatTiles";
import styles from "./Stats.module.css";

// Busy swarms report usage after every turn of every agent; refetch at most this often.
export const STATS_REFRESH_MS = 2000;

/** Stats tab: one panel across both columns with the totals and the per-agent table. */
export function StatsPage() {
  const { id = "" } = useParams();
  const stream = useSwarmStream();
  const stats = useAsync((signal) => fetchStats(id, signal), [id, stream.openCount]);
  const refresh = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(refresh.current), []);
  useStreamListener(stream, (event) => {
    if (event.type !== "usage.updated" && event.type !== "participant.updated") return;
    if (refresh.current !== undefined) return;
    refresh.current = setTimeout(() => {
      refresh.current = undefined;
      stats.reload();
    }, STATS_REFRESH_MS);
  });

  const content = () => {
    if (!stats.data) return stats.error ? null : <SkeletonRows count={6} />;
    const { agents, totals } = stats.data;
    return (
      <>
        <StatTiles totals={totals} />
        {agents.length === 0 ? (
          <EmptyState icon={ChartColumn} text="No agents yet" />
        ) : (
          <Panel inset className={styles.tableBox}>
            <div className={styles.tableScroll}>
              <AgentStatsTable agents={agents} totals={totals} />
            </div>
          </Panel>
        )}
      </>
    );
  };

  return (
    <Panel>
      <PanelHeader title="Stats" />
      {stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>}
      {stats.error && (
        <ErrorBanner action={<Button onClick={stats.reload}>Retry</Button>}>
          {`Could not load the stats: ${stats.error.message}`}
        </ErrorBanner>
      )}
      {content()}
    </Panel>
  );
}

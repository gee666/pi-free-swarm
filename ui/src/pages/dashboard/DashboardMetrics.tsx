import type { DashboardResponse } from "../../../../src/api-types";
import { Donut, type DonutSegment } from "../../components/Donut";
import { HourBars } from "../../components/HourBars";
import { Panel, PanelHeader } from "../../components/Panel";
import { Tooltip } from "../../components/Tooltip";
import { shortDuration } from "../../lib/time";
import styles from "./Dashboard.module.css";

function DonutCard({
  title,
  segments,
  value,
  total,
  completeLabel,
  note,
}: {
  title: string;
  segments: DonutSegment[];
  value: number;
  total: number;
  completeLabel: string;
  note: string;
}) {
  return (
    <Panel aria-label={title}>
      <PanelHeader title={title} />
      <div className={styles.donutLayout}>
        <Donut label={title} segments={segments} value={value} total={total} completeLabel={completeLabel} />
        <div className={styles.legendArea}>
          <ul className={styles.legend} aria-label={`${title} legend`}>
            {segments.map((segment) => (
              <li key={segment.label}>
                <span className={styles.swatch} style={{ background: segment.color }} />
                <span>{segment.label}</span>
                <span className={styles.count}>{segment.count}</span>
                <span className={styles.percent}>{total > 0 ? Math.round((segment.count / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.metricNote}>{note}</p>
    </Panel>
  );
}

export function DashboardMetrics({ data }: { data: DashboardResponse }) {
  const c = data.counts;
  return (
    <div className={styles.metrics}>
      <DonutCard
        title="Tasks"
        value={c.accepted}
        total={c.tasks}
        completeLabel="done"
        segments={[
          { label: "Done", count: c.accepted, color: "var(--accent)" },
          { label: "In review", count: c.inReview, color: "var(--accent-strong)" },
          { label: "In progress", count: c.inProgress, color: "var(--accent-dim)" },
          { label: "Not started", count: c.tasks - c.accepted - c.inReview - c.inProgress, color: "var(--bg-chip)" },
        ]}
        note={`${c.waiting} waiting on dependencies · ${c.runnable} ready to start`}
      />
      <DonutCard
        title="Criteria"
        value={c.satisfied}
        total={c.criteria}
        completeLabel="satisfied"
        segments={[
          { label: "Satisfied", count: c.satisfied, color: "var(--accent)" },
          { label: "Blocked", count: c.blocked, color: "var(--text-muted)" },
          { label: "Incomplete", count: c.incomplete, color: "var(--accent-dim)" },
          { label: "Unlinked", count: c.unlinked, color: "var(--bg-chip)" },
        ]}
        note={`${c.needVotes} need votes`}
      />
      <Panel aria-label="Pace">
        <PanelHeader title="Accepted per hour" />
        <div className={styles.pace}>
          <HourBars buckets={data.throughput} />
          <div className={styles.paceSummary}>
            <span className={styles.big}>{data.velocity.accepted60Minutes}</span>
            <span className={styles.note}>last hour</span>
            <span className={styles.eta}>
              {data.etaMs === null ? (
                <Tooltip content="Needs 30 min of run time and 5 accepted tasks in the last hour">
                  <span tabIndex={0}>ETA unknown</span>
                </Tooltip>
              ) : (
                `ETA ~${shortDuration(data.etaMs)}`
              )}
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

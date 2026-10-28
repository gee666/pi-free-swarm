import { Link, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { RUN_LABELS, useDashboard } from "../../api/dashboard";
import { Button } from "../../components/Button";
import { FileLink } from "../../components/FilePreview";
import { IdLink } from "../../components/IdLink";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList, rowFocusProps } from "../../components/RowList";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { activityLabel, gateDetail, GATE_FILTERS, GATE_LABELS } from "./dashboardModel";
import { relativeTime, shortDuration } from "../../lib/time";
import { DashboardGroups } from "./DashboardGroups";
import { DashboardMetrics } from "./DashboardMetrics";
import styles from "./Dashboard.module.css";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function DashboardPage() {
  const { id: swarmId = "" } = useParams();
  const state = useDashboard();
  const data = state.data;
  const root = `/s/${swarmId}/`;
  return (
    <Panel aria-label="Dashboard">
      <PanelBody className={styles.content}>
        {state.error && (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        )}
        {!data ? (
          !state.error && <SkeletonRows />
        ) : (
          <>
            <header>
              <div className={styles.runHeader}>
                <h1>{RUN_LABELS[data.header.state]}</h1>
                <span>
                  · Run {data.run.number} · {data.run.agentCount} agents ·{" "}
                  {data.run.startedAt === null ? "not started" : shortDuration(Date.now() - data.run.startedAt)} ·{" "}
                  {dollars.format(data.run.costUsd)}
                </span>
              </div>
              {(data.attention.userMentions > 0 || data.attention.agreedBlockers.length > 0) && (
                <p className={styles.attention}>
                  {data.attention.userMentions > 0 && (
                    <Link to={root + "wall"}>
                      {data.attention.userMentions} {data.attention.userMentions === 1 ? "mention" : "mentions"}
                    </Link>
                  )}
                  {data.attention.userMentions > 0 && data.attention.agreedBlockers.length > 0 && " · "}
                  {data.attention.agreedBlockers.length > 0 && (
                    <Link to={root + "criteria?status=blocked"}>
                      {data.attention.agreedBlockers.length} agreed{" "}
                      {data.attention.agreedBlockers.length === 1 ? "blocker" : "blockers"}
                    </Link>
                  )}
                </p>
              )}
              <p className={styles.intent}>
                <span>{data.project.intentSummary ?? "Intent not recorded yet"}</span>
                {data.project.intentPath && <FileLink reference={data.project.intentPath}>Intent</FileLink>}
                {data.project.briefPath && <FileLink reference={data.project.briefPath}>Brief</FileLink>}
              </p>
            </header>
            <DashboardMetrics data={data} />
            <Panel>
              <PanelHeader title="Stop rules" />
              <RowList>
                {data.gates.map((gate) => {
                  const body = (
                    <>
                      <span className={gate.ok ? styles.met : styles.unmet}>
                        {gate.ok ? <Check size={14} aria-label="Met" /> : <span aria-label="Unmet">●</span>}
                      </span>
                      <span>{GATE_LABELS[gate.key]}</span>
                      <span className={styles.gateDetail}>{gateDetail(data, gate)}</span>
                    </>
                  );
                  return gate.ok ? (
                    <div className={styles.gate} key={gate.key}>
                      {body}
                    </div>
                  ) : (
                    <Link {...rowFocusProps} className={styles.gate} key={gate.key} to={root + GATE_FILTERS[gate.key]}>
                      {body}
                    </Link>
                  );
                })}
              </RowList>
            </Panel>
            <div className={styles.columns}>
              <DashboardGroups swarmId={swarmId} groups={data.criteriaCoverage} />
              <Panel>
                <PanelHeader title="Recent activity" />
                {data.recentActivity.length === 0 ? (
                  <p className={styles.empty}>No activity yet</p>
                ) : (
                  <ol className={styles.activity}>
                    {data.recentActivity.slice(0, 15).map((entry) => (
                      <li key={entry.id}>
                        <span className={styles.activityText}>
                          <span className={styles.actor}>{entry.actor}</span> {activityLabel(entry.kind)}{" "}
                          <IdLink swarmId={swarmId} kind={entry.targetKind} id={entry.targetId} title={entry.title} />{" "}
                          {entry.title}
                        </span>
                        <span className={styles.time}>{relativeTime(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
